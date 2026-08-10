import { createSupabaseStripeEventRepository } from "@/adapters/supabase/stripe-event-repository";
import { createStripeWebhookAdapter } from "@/adapters/stripe/webhook";
import {
  createStripeWebhookLifecycleHttpTransport,
  createStripeWebhookLifecycleVerifier,
} from "@/adapters/stripe/webhook-lifecycle";
import { parseServerConfig } from "@/lib/config/server";

export function createStripeWebhookRuntime() {
  const config = parseServerConfig(process.env);
  return {
    events: createSupabaseStripeEventRepository(config),
    hmacSecrets: config.hmacSecrets,
    lifecycle: createStripeWebhookLifecycleVerifier(
      createStripeWebhookLifecycleHttpTransport(config.stripeSecretKey),
      {
        amountCents: config.seasonPassPriceCents,
        currency: "usd",
        livemode: config.stripeSecretKey.startsWith("sk_live_"),
        priceId: config.stripePriceId,
      },
    ),
    webhook: createStripeWebhookAdapter(config.stripeWebhookSecret),
  };
}
