import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createStripeWebhookHandler } from "@/app/api/v1/billing/stripe-webhook/handler";
import {
  createStripeWebhookAdapter,
  StripeWebhookSignatureError,
} from "@/adapters/stripe/webhook";
import { createStripeWebhookLifecycleVerifier } from "@/adapters/stripe/webhook-lifecycle";
import type { CheckoutBindingId } from "@/contracts/domain/ids";
import type { StripeEventRepository } from "@/repositories/stripe-event-repository";
import {
  processStripeWebhook,
  StripeLifecycleVerificationError,
  type StripeLifecycleVerifier,
} from "@/services/billing/process-webhook";

const secret = "whsec_test_storybridge";
const now = new Date("2026-08-10T16:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1_000);
const bindingId = "f4000000-0000-4000-8000-000000000001" as CheckoutBindingId;

function signature(payload: string, at = timestamp) {
  const digest = createHmac("sha256", secret)
    .update(`${at}.${payload}`, "utf8")
    .digest("hex");
  return `t=${at},v1=${digest}`;
}

function event(
  type = "checkout.session.completed",
  object: Record<string, unknown> = {
    id: "cs_test_storybridge",
    metadata: {
      storybridge_binding_id: bindingId,
      storybridge_season: "2026-2027",
      storybridge_user_binding: `v1.${"u".repeat(43)}`,
    },
    object: "checkout.session",
  },
) {
  return {
    api_version: "2026-03-25.dahlia",
    created: timestamp - 10,
    data: { object },
    id: "evt_test_storybridge",
    livemode: false,
    object: "event",
    type,
  };
}

function repository(
  decision: Awaited<ReturnType<StripeEventRepository["commit"]>> = {
    type: "PROCESSED",
  },
): StripeEventRepository {
  return { commit: vi.fn().mockResolvedValue(decision) };
}

const verified = {
  amountCents: 2_499,
  bindingId,
  chargeId: "ch_test_storybridge",
  currency: "usd" as const,
  customerId: "cus_test_storybridge",
  eventCreatedAt: new Date((timestamp - 10) * 1_000),
  eventId: "evt_test_storybridge",
  eventType: "checkout.session.completed" as const,
  kind: "COMPLETE" as const,
  livemode: false,
  mode: "payment" as const,
  paymentIntentId: "pi_test_storybridge",
  priceId: "price_season_pass",
  season: "2026-2027" as const,
  sessionId: "cs_test_storybridge",
  userBindingHmac: `v1.${"u".repeat(43)}`,
};

describe("Stripe webhook signature boundary", () => {
  it("verifies the exact raw body before parsing an additive event payload", () => {
    const payload = JSON.stringify({ ...event(), additive_provider_field: 1 });
    const adapter = createStripeWebhookAdapter(secret);

    expect(
      adapter.parse(new TextEncoder().encode(payload), signature(payload), now),
    ).toMatchObject({
      eventId: "evt_test_storybridge",
      kind: "CHECKOUT",
      sessionId: "cs_test_storybridge",
      type: "checkout.session.completed",
    });
  });

  it.each(["tampered body", "stale timestamp"])(
    "rejects %s before domain processing",
    (scenario) => {
      const payload = JSON.stringify(event());
      const raw =
        scenario === "tampered body"
          ? new TextEncoder().encode(`${payload} `)
          : new TextEncoder().encode(payload);
      const header =
        scenario === "stale timestamp"
          ? signature(payload, timestamp - 301)
          : signature(payload);
      expect(() =>
        createStripeWebhookAdapter(secret).parse(raw, header, now),
      ).toThrow(StripeWebhookSignatureError);
    },
  );

  it("classifies unsupported signed events without trusting their object", () => {
    const payload = JSON.stringify(
      event("customer.created", { hostile: true }),
    );
    expect(
      createStripeWebhookAdapter(secret).parse(
        new TextEncoder().encode(payload),
        signature(payload),
        now,
      ),
    ).toMatchObject({ kind: "UNSUPPORTED", type: "customer.created" });
  });

  it("classifies a malformed supported object for durable rejection", () => {
    const payload = JSON.stringify(
      event("checkout.session.completed", { hostile: true }),
    );
    expect(
      createStripeWebhookAdapter(secret).parse(
        new TextEncoder().encode(payload),
        signature(payload),
        now,
      ),
    ).toMatchObject({
      eventId: "evt_test_storybridge",
      kind: "INVALID",
      type: "checkout.session.completed",
    });
  });
});

describe("Stripe webhook processing", () => {
  it("commits verified completion data through the atomic event repository", async () => {
    const events = repository();
    const lifecycle: StripeLifecycleVerifier = {
      verify: vi.fn().mockResolvedValue(verified),
    };
    const payload = JSON.stringify(event());

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("ACKNOWLEDGED");
    expect(events.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "COMPLETE",
        amountCents: 2_499,
        bindingId,
        eventId: "evt_test_storybridge",
        payloadHmac: expect.stringMatching(/^v1\./),
        priceId: "price_season_pass",
      }),
    );
  });

  it("records provider retrieval failures for retry and asks Stripe to redeliver", async () => {
    const events = repository({ type: "RETRY_PENDING" });
    const lifecycle: StripeLifecycleVerifier = {
      verify: vi
        .fn()
        .mockRejectedValue(new StripeLifecycleVerificationError("TRANSIENT")),
    };
    const payload = JSON.stringify(event());

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("RETRY");
    expect(events.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RETRY",
        safeFailureCode: "PROVIDER_RETRIEVAL_FAILED",
      }),
    );
  });

  it("acknowledges a terminal replay even if provider retrieval is temporarily unavailable", async () => {
    const events = repository({ type: "REPLAY" });
    const lifecycle: StripeLifecycleVerifier = {
      verify: vi
        .fn()
        .mockRejectedValue(new StripeLifecycleVerificationError("TRANSIENT")),
    };
    const payload = JSON.stringify(event());

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("ACKNOWLEDGED");
  });

  it.each([
    ["PERMANENT", true, "PROVIDER_CONTRACT_MISMATCH"],
    ["UNRELATED", false, "UNRELATED_EVENT"],
  ] as const)(
    "terminally records %s verification failures with the right alert policy",
    async (kind, alertOperator, safeFailureCode) => {
      const events = repository({ type: "REJECTED" });
      const lifecycle: StripeLifecycleVerifier = {
        verify: vi
          .fn()
          .mockRejectedValue(new StripeLifecycleVerificationError(kind)),
      };
      const payload = JSON.stringify(event());

      await expect(
        processStripeWebhook(
          new TextEncoder().encode(payload),
          signature(payload),
          {
            events,
            hmacSecrets: {
              content: "content-secret-at-least-32-characters",
              idempotency: "idempotency-secret-at-least-32-characters",
              ip: "ip-secret-at-least-32-characters",
            },
            lifecycle,
            webhook: createStripeWebhookAdapter(secret),
          },
          now,
        ),
      ).resolves.toBe("ACKNOWLEDGED");
      expect(events.commit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "REJECT",
          alertOperator,
          safeFailureCode,
        }),
      );
    },
  );

  it("keeps unexpected verifier failures retryable instead of acknowledging them", async () => {
    const events = repository({ type: "RETRY_PENDING" });
    const lifecycle: StripeLifecycleVerifier = {
      verify: vi
        .fn()
        .mockRejectedValue(new Error("transport implementation failed")),
    };
    const payload = JSON.stringify(event());

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("RETRY");
    expect(events.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RETRY",
        alertOperator: true,
        safeFailureCode: "INTERNAL_PROCESSING_FAILED",
      }),
    );
  });

  it("records unsupported signed events as terminal without retrieval", async () => {
    const events = repository({ type: "REJECTED" });
    const lifecycle: StripeLifecycleVerifier = { verify: vi.fn() };
    const payload = JSON.stringify(event("customer.created", { id: "cus_x" }));

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("ACKNOWLEDGED");
    expect(lifecycle.verify).not.toHaveBeenCalled();
  });

  it("records malformed supported events as terminal with an operator alert", async () => {
    const events = repository({ type: "REJECTED" });
    const lifecycle: StripeLifecycleVerifier = { verify: vi.fn() };
    const payload = JSON.stringify(
      event("checkout.session.completed", { hostile: true }),
    );

    await expect(
      processStripeWebhook(
        new TextEncoder().encode(payload),
        signature(payload),
        {
          events,
          hmacSecrets: {
            content: "content-secret-at-least-32-characters",
            idempotency: "idempotency-secret-at-least-32-characters",
            ip: "ip-secret-at-least-32-characters",
          },
          lifecycle,
          webhook: createStripeWebhookAdapter(secret),
        },
        now,
      ),
    ).resolves.toBe("ACKNOWLEDGED");
    expect(events.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REJECT",
        alertOperator: true,
        safeFailureCode: "PROVIDER_CONTRACT_MISMATCH",
      }),
    );
    expect(lifecycle.verify).not.toHaveBeenCalled();
  });
});

describe("Stripe lifecycle correlation", () => {
  const metadata = {
    storybridge_binding_id: bindingId,
    storybridge_season: "2026-2027",
    storybridge_user_binding: `v1.${"u".repeat(43)}`,
  };
  const paymentIntent = {
    amount_received: 2_499,
    currency: "usd",
    id: "pi_test_storybridge",
    latest_charge: { id: "ch_test_storybridge", object: "charge" },
    livemode: false,
    metadata,
    object: "payment_intent",
    status: "succeeded",
  };
  const completedSession = {
    amount_total: 2_499,
    currency: "usd",
    customer: "cus_test_storybridge",
    id: "cs_test_storybridge",
    line_items: {
      data: [
        {
          amount_total: 2_499,
          price: { id: "price_season_pass", object: "price" },
          quantity: 1,
        },
      ],
    },
    livemode: false,
    metadata,
    mode: "payment",
    object: "checkout.session",
    payment_intent: paymentIntent,
    payment_status: "paid",
    status: "complete",
  };

  function verifier(overrides: Record<string, unknown> = {}) {
    return createStripeWebhookLifecycleVerifier(
      {
        listCheckoutSessions: vi.fn().mockResolvedValue({
          data: [completedSession],
          object: "list",
        }),
        retrieveCharge: vi.fn().mockResolvedValue({
          amount: 2_499,
          amount_refunded: 2_499,
          currency: "usd",
          id: "ch_test_storybridge",
          livemode: false,
          object: "charge",
          payment_intent: paymentIntent,
          refunded: true,
        }),
        retrieveCheckoutSession: vi
          .fn()
          .mockResolvedValue({ ...completedSession, ...overrides }),
      },
      {
        amountCents: 2_499,
        currency: "usd",
        livemode: false,
        priceId: "price_season_pass",
      },
    );
  }

  it("grants only after Checkout and PaymentIntent agree with server pricing and metadata", async () => {
    const payload = JSON.stringify(event());
    const candidate = createStripeWebhookAdapter(secret).parse(
      new TextEncoder().encode(payload),
      signature(payload),
      now,
    );
    if (candidate.kind !== "CHECKOUT" && candidate.kind !== "REVERSAL") {
      throw new Error("test setup");
    }

    await expect(verifier().verify(candidate)).resolves.toEqual(verified);
  });

  it("records a correlated unpaid expired Checkout without payment identifiers", async () => {
    const payload = JSON.stringify(event("checkout.session.expired"));
    const candidate = createStripeWebhookAdapter(secret).parse(
      new TextEncoder().encode(payload),
      signature(payload),
      now,
    );
    if (candidate.kind !== "CHECKOUT" && candidate.kind !== "REVERSAL") {
      throw new Error("test setup");
    }

    await expect(
      verifier({
        payment_intent: null,
        payment_status: "unpaid",
        status: "expired",
      }).verify(candidate),
    ).resolves.toMatchObject({
      bindingId,
      chargeId: null,
      kind: "EXPIRE",
      paymentIntentId: null,
    });
  });

  it.each([
    ["wrong amount", { amount_total: 2_498 }],
    ["wrong live mode", { livemode: true }],
    ["unpaid", { payment_status: "unpaid" }],
    [
      "mismatched payment metadata",
      {
        payment_intent: {
          ...paymentIntent,
          metadata: { ...metadata, storybridge_season: "2027-2028" },
        },
      },
    ],
  ])("rejects completion with %s", async (_scenario, override) => {
    const payload = JSON.stringify(event());
    const candidate = createStripeWebhookAdapter(secret).parse(
      new TextEncoder().encode(payload),
      signature(payload),
      now,
    );
    if (candidate.kind !== "CHECKOUT" && candidate.kind !== "REVERSAL") {
      throw new Error("test setup");
    }

    await expect(verifier(override).verify(candidate)).rejects.toMatchObject({
      kind: "PERMANENT",
    });
  });

  it("correlates a refund through charge, PaymentIntent, and exactly one Checkout session", async () => {
    const payload = JSON.stringify(
      event("charge.refunded", {
        amount: 2_499,
        amount_refunded: 2_499,
        currency: "usd",
        id: "ch_test_storybridge",
        object: "charge",
        payment_intent: "pi_test_storybridge",
      }),
    );
    const candidate = createStripeWebhookAdapter(secret).parse(
      new TextEncoder().encode(payload),
      signature(payload),
      now,
    );
    if (candidate.kind !== "CHECKOUT" && candidate.kind !== "REVERSAL") {
      throw new Error("test setup");
    }

    await expect(verifier().verify(candidate)).resolves.toMatchObject({
      bindingId,
      chargeId: "ch_test_storybridge",
      kind: "REFUND",
      paymentIntentId: "pi_test_storybridge",
      sessionId: "cs_test_storybridge",
    });
  });
});

describe("Stripe webhook HTTP boundary", () => {
  it.each([
    ["ACKNOWLEDGED", 200],
    ["RETRY", 500],
  ] as const)(
    "maps %s processing to an empty %i response",
    async (decision, status) => {
      const process = vi.fn().mockResolvedValue(decision);
      const payload = JSON.stringify(event());
      const response = await createStripeWebhookHandler({ process })(
        new Request("https://storybridge.test/api/v1/billing/stripe-webhook", {
          body: payload,
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature(payload),
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(status);
      await expect(response.text()).resolves.toBe("");
      const [receivedBody, receivedSignature] = process.mock.calls[0] as [
        Uint8Array,
        string,
      ];
      expect(new TextDecoder().decode(receivedBody)).toBe(payload);
      expect(receivedSignature).toBe(signature(payload));
    },
  );

  it.each([
    ["missing signature", {}],
    ["wrong content type", { "content-type": "text/plain" }],
  ])("rejects %s without processing", async (_scenario, headers) => {
    const process = vi.fn();
    const response = await createStripeWebhookHandler({ process })(
      new Request("https://storybridge.test/api/v1/billing/stripe-webhook", {
        body: "{}",
        headers,
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(process).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification rejects the request", async () => {
    const process = vi
      .fn()
      .mockRejectedValue(new StripeWebhookSignatureError());
    const response = await createStripeWebhookHandler({ process })(
      new Request("https://storybridge.test/api/v1/billing/stripe-webhook", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "invalid",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });
});
