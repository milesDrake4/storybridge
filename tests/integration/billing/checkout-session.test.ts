import { describe, expect, it, vi } from "vitest";

import { createCheckoutSessionHandler } from "@/app/api/v1/billing/checkout-sessions/handler";
import { createStripeCheckoutAdapter } from "@/adapters/stripe/checkout";
import type { CheckoutBindingId, UserId } from "@/contracts/domain/ids";
import { createCheckoutSessionInputSchema } from "@/contracts/http/v1/billing";
import type { CheckoutSessionRepository } from "@/repositories/checkout-session-repository";
import type { StripeCheckoutPort } from "@/services/billing/stripe-checkout-port";
import { createCheckoutSession } from "@/services/billing/create-checkout";

const appUrl = new URL("https://storybridge.test");
const now = new Date("2026-08-04T16:00:00.000Z");
const expiresAt = new Date("2026-08-04T17:00:00.000Z");
const userId = "f0000000-0000-4000-8000-000000000001" as UserId;
const bindingId = "f3000000-0000-4000-8000-000000000001" as CheckoutBindingId;
const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_safe";

function eligibility() {
  return {
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          createdAt: now.toISOString(),
          displayName: null,
          onboardingState: "NOT_STARTED" as const,
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
          updatedAt: now.toISOString(),
          userId,
        },
      }),
      recordConsent: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

function repository(
  reserveResult: Awaited<ReturnType<CheckoutSessionRepository["reserve"]>> = {
    bindingId,
    expiresAt,
    type: "PENDING",
  },
): CheckoutSessionRepository {
  return {
    finalize: vi.fn().mockResolvedValue({ type: "FINALIZED" }),
    reserve: vi.fn().mockResolvedValue(reserveResult),
  };
}

function provider(): StripeCheckoutPort {
  return {
    createSession: vi.fn().mockResolvedValue({
      checkoutUrl,
      customerId: null,
      expiresAt,
      sessionId: "cs_test_safe",
    }),
  };
}

function dependencies(sessions = repository(), stripe = provider()) {
  return {
    ...eligibility(),
    appUrl,
    currency: "usd" as const,
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
    },
    priceId: "price_season_pass",
    priceCents: 2_499,
    sessions,
    stripe,
  };
}

describe("checkout session contract", () => {
  it("accepts only the current application season", () => {
    expect(
      createCheckoutSessionInputSchema.parse({ season: "2026-2027" }),
    ).toEqual({ season: "2026-2027" });

    for (const extra of [
      { amount: 1 },
      { currency: "eur" },
      { mode: "subscription" },
      { priceId: "price_attacker" },
      { userId },
    ]) {
      expect(() =>
        createCheckoutSessionInputSchema.parse({
          season: "2026-2027",
          ...extra,
        }),
      ).toThrow();
    }
  });
});

describe("checkout session service", () => {
  it("binds a reserved checkout to server-controlled price details and metadata", async () => {
    const sessions = repository();
    const stripe = provider();

    const result = await createCheckoutSession(
      { season: "2026-2027" },
      { idempotencyKey: "checkout-create-key-0001" },
      dependencies(sessions, stripe),
      now,
      () => bindingId,
    );

    expect(result).toEqual({ checkoutUrl, expiresAt: expiresAt.toISOString() });
    expect(sessions.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 2_499,
        bindingId,
        currency: "usd",
        idempotencyKeyHmac: expect.stringMatching(/^v1\./),
        mode: "payment",
        priceId: "price_season_pass",
        requestHmac: expect.stringMatching(/^v1\./),
        season: "2026-2027",
        userBindingHmac: expect.stringMatching(/^v1\./),
        userId,
      }),
    );
    expect(stripe.createSession).toHaveBeenCalledWith({
      amountCents: 2_499,
      bindingId,
      cancelUrl: "https://storybridge.test/essays?checkout=cancelled",
      currency: "usd",
      expiresAt,
      idempotencyKey: `storybridge-checkout:${bindingId}`,
      metadata: {
        storybridge_binding_id: bindingId,
        storybridge_season: "2026-2027",
        storybridge_user_binding: expect.stringMatching(/^v1\./),
      },
      mode: "payment",
      priceId: "price_season_pass",
      successUrl: "https://storybridge.test/essays?checkout=completed",
    });
    expect(sessions.finalize).toHaveBeenCalledWith({
      bindingId,
      checkoutUrl,
      customerId: null,
      expiresAt,
      now,
      sessionId: "cs_test_safe",
    });
  });

  it("returns the original open URL without creating a duplicate provider session", async () => {
    const sessions = repository({
      bindingId,
      checkoutUrl,
      expiresAt,
      type: "READY",
    });
    const stripe = provider();

    await expect(
      createCheckoutSession(
        { season: "2026-2027" },
        { idempotencyKey: "checkout-create-key-0001" },
        dependencies(sessions, stripe),
        now,
      ),
    ).resolves.toEqual({ checkoutUrl, expiresAt: expiresAt.toISOString() });
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
    ["STATE_CONFLICT", "STATE_CONFLICT"],
  ] as const)(
    "maps %s reservation decisions to a safe domain error",
    async (type, code) => {
      await expect(
        createCheckoutSession(
          { season: "2026-2027" },
          { idempotencyKey: "checkout-create-key-0001" },
          dependencies(repository({ type }), provider()),
          now,
        ),
      ).rejects.toMatchObject({ code });
    },
  );
});

describe("Stripe checkout adapter", () => {
  it("duplicates binding metadata onto Checkout and its PaymentIntent", async () => {
    const createSession = vi.fn().mockResolvedValue({
      amount_total: 2_499,
      currency: "usd",
      customer: null,
      expires_at: Math.floor(expiresAt.getTime() / 1_000),
      id: "cs_test_safe",
      metadata: {
        storybridge_binding_id: bindingId,
        storybridge_season: "2026-2027",
        storybridge_user_binding: "v1.user-binding",
      },
      mode: "payment",
      payment_status: "unpaid",
      status: "open",
      url: checkoutUrl,
    });
    const adapter = createStripeCheckoutAdapter({ createSession });

    await adapter.createSession({
      amountCents: 2_499,
      bindingId,
      cancelUrl: "https://storybridge.test/essays?checkout=cancelled",
      currency: "usd",
      expiresAt,
      idempotencyKey: `storybridge-checkout:${bindingId}`,
      metadata: {
        storybridge_binding_id: bindingId,
        storybridge_season: "2026-2027",
        storybridge_user_binding: "v1.user-binding",
      },
      mode: "payment",
      priceId: "price_season_pass",
      successUrl: "https://storybridge.test/essays?checkout=completed",
    });

    const [body, key] = createSession.mock.calls[0] as [
      URLSearchParams,
      string,
    ];
    expect(key).toBe(`storybridge-checkout:${bindingId}`);
    expect(Object.fromEntries(body)).toMatchObject({
      "payment_method_types[0]": "card",
      "line_items[0][price]": "price_season_pass",
      "line_items[0][quantity]": "1",
      "metadata[storybridge_binding_id]": bindingId,
      "metadata[storybridge_season]": "2026-2027",
      "payment_intent_data[metadata][storybridge_binding_id]": bindingId,
      "payment_intent_data[metadata][storybridge_season]": "2026-2027",
      mode: "payment",
    });
  });

  it("rejects a non-Stripe checkout URL", async () => {
    const adapter = createStripeCheckoutAdapter({
      createSession: vi.fn().mockResolvedValue({
        amount_total: 2_499,
        currency: "usd",
        customer: null,
        expires_at: Math.floor(expiresAt.getTime() / 1_000),
        id: "cs_test_safe",
        metadata: {
          storybridge_binding_id: bindingId,
          storybridge_season: "2026-2027",
          storybridge_user_binding: "v1.user-binding",
        },
        mode: "payment",
        payment_status: "unpaid",
        status: "open",
        url: "https://attacker.example/checkout",
      }),
    });
    await expect(
      adapter.createSession({
        amountCents: 2_499,
        bindingId,
        cancelUrl: "https://storybridge.test/essays?checkout=cancelled",
        currency: "usd",
        expiresAt,
        idempotencyKey: `storybridge-checkout:${bindingId}`,
        metadata: {
          storybridge_binding_id: bindingId,
          storybridge_season: "2026-2027",
          storybridge_user_binding: "v1.user-binding",
        },
        mode: "payment",
        priceId: "price_season_pass",
        successUrl: "https://storybridge.test/essays?checkout=completed",
      }),
    ).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });
});

describe("checkout session route boundary", () => {
  it("requires same-origin JSON and an idempotency key, then returns 201", async () => {
    const create = vi.fn().mockResolvedValue({
      checkoutUrl,
      expiresAt: expiresAt.toISOString(),
    });
    const response = await createCheckoutSessionHandler({ appUrl, create })(
      new Request(`${appUrl}/api/v1/billing/checkout-sessions`, {
        body: JSON.stringify({ season: "2026-2027" }),
        headers: {
          "content-type": "application/json",
          host: appUrl.host,
          "idempotency-key": "checkout-create-key-0001",
          origin: appUrl.origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { checkoutUrl, expiresAt: expiresAt.toISOString() },
    });
    expect(create).toHaveBeenCalledWith(
      { season: "2026-2027" },
      { idempotencyKey: "checkout-create-key-0001" },
    );
  });
});
