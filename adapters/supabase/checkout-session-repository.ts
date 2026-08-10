import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import { checkoutBindingIdSchema } from "@/contracts/domain/ids";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CheckoutReservation,
  CheckoutSessionRepository,
} from "@/repositories/checkout-session-repository";

const reservationSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    binding_id: checkoutBindingIdSchema,
    checkout_url: z.url(),
    decision: z.literal("READY"),
    expires_at: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    binding_id: checkoutBindingIdSchema,
    decision: z.literal("PENDING"),
    expires_at: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    decision: z.enum(["IDEMPOTENCY_KEY_REUSED", "STATE_CONFLICT"]),
  }),
]);

const finalizeSchema = z.enum([
  "FINALIZED",
  "REPLAY",
  "NOT_FOUND",
  "STATE_CONFLICT",
]);

function mapReservation(value: unknown): CheckoutReservation {
  const row = reservationSchema.parse(value);
  if (row.decision === "READY") {
    return {
      bindingId: row.binding_id,
      checkoutUrl: row.checkout_url,
      expiresAt: new Date(row.expires_at),
      type: "READY",
    };
  }
  if (row.decision === "PENDING") {
    return {
      bindingId: row.binding_id,
      expiresAt: new Date(row.expires_at),
      type: "PENDING",
    };
  }
  return { type: row.decision };
}

export function createSupabaseCheckoutSessionRepository(
  config: ServerConfig,
): CheckoutSessionRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async reserve(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("reserve_checkout_session", {
          requested_amount_cents: input.amountCents,
          requested_at: input.now.toISOString(),
          requested_binding_id: input.bindingId,
          requested_currency: input.currency,
          requested_expires_at: input.expiresAt.toISOString(),
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_mode: input.mode,
          requested_price_id: input.priceId,
          requested_request_hmac: input.requestHmac,
          requested_season: input.season,
          requested_user_binding_hmac: input.userBindingHmac,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      return mapReservation(data);
    },
    async finalize(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("finalize_checkout_session", {
          requested_at: input.now.toISOString(),
          requested_binding_id: input.bindingId,
          requested_checkout_url: input.checkoutUrl,
          requested_expires_at: input.expiresAt.toISOString(),
          requested_stripe_customer_id: input.customerId,
          requested_stripe_session_id: input.sessionId,
        });
      if (error) throw error;
      return { type: finalizeSchema.parse(data) };
    },
  };
}
