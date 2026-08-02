import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createConsentPutHandler } from "@/app/api/v1/me/consent/handler";
import { parseServerConfig } from "@/lib/config/server";
import { recordConsent } from "@/services/auth/eligibility";

export async function PUT(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const cookieMethods = toSupabaseCookieMethods(await cookies());
  const dependencies = {
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(config, cookieMethods),
  };
  return createConsentPutHandler({
    appUrl: config.appUrl,
    consent: (input) => recordConsent(input, dependencies),
  })(request);
}
