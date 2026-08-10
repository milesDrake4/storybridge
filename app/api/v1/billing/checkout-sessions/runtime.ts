import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { createSupabaseCheckoutSessionRepository } from "@/adapters/supabase/checkout-session-repository";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import {
  createStripeCheckoutAdapter,
  createStripeHttpTransport,
} from "@/adapters/stripe/checkout";
import { parseServerConfig } from "@/lib/config/server";

export async function createBillingRuntime() {
  const config = parseServerConfig(process.env);
  return {
    config,
    dependencies: {
      appUrl: config.appUrl,
      currency: "usd" as const,
      hmacSecrets: config.hmacSecrets,
      priceCents: config.seasonPassPriceCents,
      priceId: config.stripePriceId,
      profiles: createSupabaseProfileRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
      sessions: createSupabaseCheckoutSessionRepository(config),
      stripe: createStripeCheckoutAdapter(
        createStripeHttpTransport(config.stripeSecretKey),
      ),
    },
  };
}
