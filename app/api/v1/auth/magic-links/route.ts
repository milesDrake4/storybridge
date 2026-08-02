import { createSupabaseMagicLinkDependencies } from "@/adapters/supabase/auth";
import { createMagicLinkPostHandler } from "@/app/api/v1/auth/magic-links/handler";
import { parseServerConfig } from "@/lib/config/server";
import { requestMagicLink } from "@/services/auth/request-magic-link";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const serviceDependencies = createSupabaseMagicLinkDependencies(config);
  return createMagicLinkPostHandler({
    appUrl: config.appUrl,
    hmacSecrets: config.hmacSecrets,
    requestMagicLink: (input) => requestMagicLink(input, serviceDependencies),
  })(request);
}
