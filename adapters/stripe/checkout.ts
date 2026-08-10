import { z } from "zod";

import {
  StripeCheckoutError,
  type StripeCheckoutPort,
} from "@/services/billing/stripe-checkout-port";

const stripeSessionSchema = z.object({
  amount_total: z.number().int().positive(),
  currency: z.literal("usd"),
  customer: z.string().startsWith("cus_").nullable(),
  expires_at: z.number().int().positive(),
  id: z.string().startsWith("cs_"),
  metadata: z.record(z.string(), z.string()),
  mode: z.literal("payment"),
  payment_status: z.literal("unpaid"),
  status: z.literal("open"),
  url: z.url(),
});

export interface StripeCheckoutTransport {
  createSession(
    body: URLSearchParams,
    idempotencyKey: string,
  ): Promise<unknown>;
}

export function createStripeHttpTransport(
  secretKey: string,
  fetchImplementation: typeof fetch = fetch,
): StripeCheckoutTransport {
  return {
    async createSession(body, idempotencyKey) {
      const response = await fetchImplementation(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          body,
          headers: {
            authorization: `Bearer ${secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
            "idempotency-key": idempotencyKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new StripeCheckoutError("UNAVAILABLE");
      try {
        return await response.json();
      } catch {
        throw new StripeCheckoutError("INVALID_RESPONSE");
      }
    },
  };
}

function stripeHostedCheckoutUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
}

export function createStripeCheckoutAdapter(
  transport: StripeCheckoutTransport,
): StripeCheckoutPort {
  return {
    async createSession(input) {
      const body = new URLSearchParams();
      body.set("mode", input.mode);
      body.set("success_url", input.successUrl);
      body.set("cancel_url", input.cancelUrl);
      body.set(
        "expires_at",
        Math.floor(input.expiresAt.getTime() / 1_000).toString(),
      );
      body.set("line_items[0][price]", input.priceId);
      body.set("line_items[0][quantity]", "1");
      for (const [key, value] of Object.entries(input.metadata)) {
        body.set(`metadata[${key}]`, value);
        body.set(`payment_intent_data[metadata][${key}]`, value);
      }

      let rawSession: unknown;
      try {
        rawSession = await transport.createSession(body, input.idempotencyKey);
      } catch (error) {
        if (error instanceof StripeCheckoutError) throw error;
        throw new StripeCheckoutError("UNAVAILABLE");
      }
      const parsed = stripeSessionSchema.safeParse(rawSession);
      if (!parsed.success) throw new StripeCheckoutError("INVALID_RESPONSE");
      const session = parsed.data;
      if (
        session.amount_total !== input.amountCents ||
        session.currency !== input.currency ||
        !stripeHostedCheckoutUrl(session.url) ||
        session.expires_at !== Math.floor(input.expiresAt.getTime() / 1_000) ||
        Object.entries(input.metadata).some(
          ([key, value]) => session.metadata[key] !== value,
        )
      ) {
        throw new StripeCheckoutError("INVALID_RESPONSE");
      }
      return {
        checkoutUrl: session.url,
        customerId: session.customer,
        expiresAt: new Date(session.expires_at * 1_000),
        sessionId: session.id,
      };
    },
  };
}
