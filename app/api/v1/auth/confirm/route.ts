import { createAuthConfirmationPostHandler } from "@/app/api/v1/auth/confirm/handler";
import { parseServerConfig } from "@/lib/config/server";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  return createAuthConfirmationPostHandler({
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
  })(request);
}
