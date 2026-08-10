import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { ServerConfig } from "@/lib/config/server";
import type { StripeEventRepository } from "@/repositories/stripe-event-repository";

const decisionSchema = z.enum([
  "PROCESSED",
  "REJECTED",
  "REPLAY",
  "RETRY_PENDING",
]);

export function createSupabaseStripeEventRepository(
  config: ServerConfig,
): StripeEventRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_stripe_event", {
          requested_action: input.action,
          requested_alert_operator: input.alertOperator,
          requested_amount_cents: input.amountCents,
          requested_binding_id: input.bindingId,
          requested_charge_id: input.chargeId,
          requested_currency: input.currency,
          requested_customer_id: input.customerId,
          requested_event_created_at: input.eventCreatedAt.toISOString(),
          requested_event_id: input.eventId,
          requested_event_type: input.eventType,
          requested_livemode: input.livemode,
          requested_mode: input.mode,
          requested_now: input.now.toISOString(),
          requested_paid_essay_limit: config.paidEssayLimit,
          requested_payload_hmac: input.payloadHmac,
          requested_payment_intent_id: input.paymentIntentId,
          requested_price_id: input.priceId,
          requested_safe_failure_code: input.safeFailureCode,
          requested_season: input.season,
          requested_session_id: input.sessionId,
          requested_user_binding_hmac: input.userBindingHmac,
        });
      if (error) throw error;
      return { type: decisionSchema.parse(data) };
    },
  };
}
