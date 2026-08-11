import { cookies } from "next/headers";

import { createSupabaseMagicLinkDependencies } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createMagicLinkPostHandler } from "@/app/api/v1/auth/magic-links/handler";
import { parseServerConfig } from "@/lib/config/server";
import { requestMagicLink } from "@/services/auth/request-magic-link";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const cookieStore = await cookies();
  const serviceDependencies = createSupabaseMagicLinkDependencies(
    config,
    toSupabaseCookieMethods(cookieStore),
  );
  return createMagicLinkPostHandler({
    appUrl: config.appUrl,
    hmacSecrets: config.hmacSecrets,
    requestMagicLink: (input) => requestMagicLink(input, serviceDependencies),
  })(request);
}
