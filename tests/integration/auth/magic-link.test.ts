import { describe, expect, it, vi } from "vitest";

import { supabaseAuthCookieOptions } from "@/adapters/supabase/client";
import { createAuthCallbackGetHandler } from "@/app/api/v1/auth/callback/handler";
import { createMagicLinkPostHandler } from "@/app/api/v1/auth/magic-links/handler";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import { magicLinkAcceptedSchema } from "@/contracts/http/v1/auth";
import type { HmacSecrets } from "@/lib/config/server";
import type {
  EmailHmac,
  InvitationTokenHmac,
  IpHmac,
} from "@/lib/security/hmac";
import { completeMagicLink } from "@/services/auth/complete-magic-link";
import { requestMagicLink } from "@/services/auth/request-magic-link";

const allowed = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: new Date("2026-08-03T00:00:00Z"),
};

function dependencies(senderError = false) {
  return {
    invitations: { permitsSignup: vi.fn().mockResolvedValue(false) },
    rateLimit: {
      consumeEmail: vi.fn().mockResolvedValue(allowed),
      consumeIp: vi.fn().mockResolvedValue(allowed),
    },
    sender: {
      send: senderError
        ? vi.fn().mockRejectedValue(new Error("provider detail"))
        : vi.fn().mockResolvedValue(undefined),
    },
  };
}

const input = {
  email: "student@example.com",
  emailHmac: "v1.email" as EmailHmac,
  ipHmac: "v1.ip" as IpHmac,
  redirectTo: "https://storybridge.test/api/v1/auth/callback",
};

const appUrl = new URL("https://storybridge.test");
const hmacSecrets = {
  content: "content-secret-that-is-at-least-32-bytes-long",
  idempotency: "identity-secret-that-is-at-least-32-bytes-long",
  ip: "ip-address-secret-that-is-at-least-32-bytes-long",
} satisfies HmacSecrets;

describe("requestMagicLink", () => {
  it("returns the same accepted result when the provider accepts or rejects", async () => {
    const accepted = await requestMagicLink(input, dependencies());
    const concealedFailure = await requestMagicLink(input, dependencies(true));

    expect(accepted).toEqual({ type: "ACCEPTED", value: { accepted: true } });
    expect(concealedFailure).toEqual(accepted);
  });

  it("only enables account creation for a bound invitation", async () => {
    const invited = dependencies();
    invited.invitations.permitsSignup.mockResolvedValue(true);

    await requestMagicLink(
      {
        ...input,
        inviteTokenHmac: "v1.invite-token" as InvitationTokenHmac,
      },
      invited,
    );

    expect(invited.sender.send).toHaveBeenCalledWith({
      email: input.email,
      redirectTo: input.redirectTo,
      shouldCreateUser: true,
    });
  });

  it("returns email-limit precedence without invoking invitation or provider", async () => {
    const limited = dependencies();
    const emailDecision = { ...allowed, allowed: false, remaining: 0 };
    limited.rateLimit.consumeEmail.mockResolvedValue(emailDecision);
    limited.rateLimit.consumeIp.mockResolvedValue({
      ...emailDecision,
      limit: 20,
    });

    const result = await requestMagicLink(input, limited);

    expect(result).toEqual({ type: "RATE_LIMITED", decision: emailDecision });
    expect(limited.invitations.permitsSignup).not.toHaveBeenCalled();
    expect(limited.sender.send).not.toHaveBeenCalled();
  });
});

describe("completeMagicLink", () => {
  it("binds a pending invitation to the authenticated identity", async () => {
    const acceptForIdentity = vi.fn().mockResolvedValue(undefined);

    await completeMagicLink("single-use", {
      exchange: {
        redeem: vi.fn().mockResolvedValue({
          email: "student@example.com",
          userId: "10000000-0000-0000-0000-000000000001",
        }),
      },
      invitations: { acceptForIdentity },
    });

    expect(acceptForIdentity).toHaveBeenCalledWith({
      email: "student@example.com",
      userId: "10000000-0000-0000-0000-000000000001",
    });
  });
});

describe("Supabase auth cookies", () => {
  it("uses the required HTTP-only secure same-site policy", () => {
    expect(supabaseAuthCookieOptions(appUrl)).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});

describe("POST /api/v1/auth/magic-links", () => {
  it("returns the same 202 envelope for every concealed service outcome", async () => {
    const acceptedService = vi.fn().mockResolvedValue({
      type: "ACCEPTED",
      value: { accepted: true },
    });
    const concealedProviderFailure = vi.fn().mockResolvedValue({
      type: "ACCEPTED",
      value: { accepted: true },
    });
    const request = () =>
      new Request("https://storybridge.test/api/v1/auth/magic-links", {
        body: JSON.stringify({
          email: " Student@Example.COM ",
          inviteToken: "raw-invitation-token",
        }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.42",
        },
        method: "POST",
      });

    const first = await createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      now: () => new Date("2026-08-02T12:00:00Z"),
      requestMagicLink: acceptedService,
    })(request());
    const second = await createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      now: () => new Date("2026-08-02T12:00:00Z"),
      requestMagicLink: concealedProviderFailure,
    })(request());

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(
      apiSuccessSchema(magicLinkAcceptedSchema).parse(await first.json()).data,
    ).toEqual({ accepted: true });
    expect(
      apiSuccessSchema(magicLinkAcceptedSchema).parse(await second.json()).data,
    ).toEqual({ accepted: true });
    expect(acceptedService).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "student@example.com",
        inviteTokenHmac: expect.not.stringContaining("raw-invitation-token"),
        ipHmac: expect.not.stringContaining("203.0.113.42"),
      }),
    );
  });

  it("rotates the keyed IP identifier at the UTC day boundary", async () => {
    const service = vi.fn().mockResolvedValue({
      type: "ACCEPTED",
      value: { accepted: true },
    });
    const request = () =>
      new Request("https://storybridge.test/api/v1/auth/magic-links", {
        body: JSON.stringify({ email: "student@example.com" }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.42",
        },
        method: "POST",
      });

    await createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      now: () => new Date("2026-08-02T23:59:59Z"),
      requestMagicLink: service,
    })(request());
    await createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      now: () => new Date("2026-08-03T00:00:00Z"),
      requestMagicLink: service,
    })(request());

    expect(service.mock.calls[0]?.[0].ipHmac).not.toBe(
      service.mock.calls[1]?.[0].ipHmac,
    );
  });

  it("rejects invalid request boundaries without calling the service", async () => {
    const service = vi.fn();
    const response = await createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      requestMagicLink: service,
    })(
      new Request("https://storybridge.test/api/v1/auth/magic-links", {
        body: JSON.stringify({ email: "student@example.com" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "INVALID_CONTENT_TYPE",
    );
    expect(service).not.toHaveBeenCalled();
  });

  it("maps a limit decision to the declared 429 envelope and integer headers", async () => {
    const handler = createMagicLinkPostHandler({
      appUrl,
      hmacSecrets,
      now: () => new Date("2026-08-02T23:59:50Z"),
      requestMagicLink: vi.fn().mockResolvedValue({
        type: "RATE_LIMITED",
        decision: {
          allowed: false,
          limit: 5,
          remaining: 0,
          resetAt: new Date("2026-08-03T00:00:00Z"),
        },
      }),
    });

    const response = await handler(
      new Request("https://storybridge.test/api/v1/auth/magic-links", {
        body: JSON.stringify({ email: "student@example.com" }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.42",
        },
        method: "POST",
      }),
    );

    const body = apiErrorSchema.parse(await response.json());
    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({
      code: "RATE_LIMITED",
      resetAt: "2026-08-03T00:00:00.000Z",
    });
    expect(response.headers.get("retry-after")).toBe("10");
    expect(response.headers.get("ratelimit-limit")).toBe("5");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-reset")).toBe("1785715200");
  });
});

describe("GET /api/v1/auth/callback", () => {
  it("redeems a valid code once and redirects only to an allowlisted route", async () => {
    const usedCodes = new Set<string>();
    const exchange = vi.fn(async (code: string) => {
      if (usedCodes.has(code)) throw new Error("provider code already used");
      usedCodes.add(code);
    });
    const handler = createAuthCallbackGetHandler({ appUrl, exchange });

    const first = await handler(
      new Request(
        "https://storybridge.test/api/v1/auth/callback?code=single-use&next=%2Fdashboard",
      ),
    );
    const replay = await handler(
      new Request(
        "https://storybridge.test/api/v1/auth/callback?code=single-use&next=%2Fdashboard",
      ),
    );

    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(
      "https://storybridge.test/dashboard",
    );
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe(
      "https://storybridge.test/sign-in?error=AUTH_CALLBACK_FAILED",
    );
  });

  it("rejects external and unlisted redirects before exchanging a code", async () => {
    const exchange = vi.fn().mockResolvedValue(undefined);
    const handler = createAuthCallbackGetHandler({ appUrl, exchange });

    const external = await handler(
      new Request(
        "https://storybridge.test/api/v1/auth/callback?code=valid&next=https%3A%2F%2Fevil.test",
      ),
    );
    const unlisted = await handler(
      new Request(
        "https://storybridge.test/api/v1/auth/callback?code=valid&next=%2Fadmin",
      ),
    );

    expect(external.headers.get("location")).toBe(
      "https://storybridge.test/sign-in?error=AUTH_CALLBACK_FAILED",
    );
    expect(unlisted.headers.get("location")).toBe(
      "https://storybridge.test/sign-in?error=AUTH_CALLBACK_FAILED",
    );
    expect(exchange).not.toHaveBeenCalled();
  });
});
