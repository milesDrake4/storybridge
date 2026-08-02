import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { createSupabaseInterviewRepository } from "@/adapters/supabase/interview-repository";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createInterviewStartPostHandler } from "@/app/api/v1/interview-sessions/handler";
import { parseServerConfig } from "@/lib/config/server";
import { startInterview } from "@/services/interview/interview-service";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  const dependencies = {
    interviews: createSupabaseInterviewRepository(config),
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(
      config,
      toSupabaseCookieMethods(await cookies()),
    ),
  };
  return createInterviewStartPostHandler({
    appUrl: config.appUrl,
    start: () => startInterview(dependencies),
  })(request);
}
