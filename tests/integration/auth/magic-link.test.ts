import { describe, expect, it, vi } from "vitest";

import type { EmailHmac, IpHmac } from "@/lib/security/hmac";
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

    await requestMagicLink({ ...input, inviteToken: "invite-token" }, invited);

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
