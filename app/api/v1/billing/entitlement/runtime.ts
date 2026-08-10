import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { createSupabaseEntitlementRepository } from "@/adapters/supabase/entitlement-repository";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { parseServerConfig } from "@/lib/config/server";
import { cookies } from "next/headers";

export async function createBillingEntitlementRuntime() {
  const config = parseServerConfig(process.env);
  const cookieMethods = toSupabaseCookieMethods(await cookies());
  return {
    entitlements: createSupabaseEntitlementRepository(config),
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(config, cookieMethods),
  };
}
