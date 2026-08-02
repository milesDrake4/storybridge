import { cookies } from "next/headers";

import { createSupabaseCompleteMagicLinkDependencies } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createAuthCallbackGetHandler } from "@/app/api/v1/auth/callback/handler";
import { parseServerConfig } from "@/lib/config/server";
import { completeMagicLink } from "@/services/auth/complete-magic-link";

export async function GET(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const cookieStore = await cookies();
  const serviceDependencies = createSupabaseCompleteMagicLinkDependencies(
    config,
    toSupabaseCookieMethods(cookieStore),
  );
  return createAuthCallbackGetHandler({
    appUrl: config.appUrl,
    exchange: (code) => completeMagicLink(code, serviceDependencies),
  })(request);
}
