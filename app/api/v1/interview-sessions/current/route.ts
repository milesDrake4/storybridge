import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { createSupabaseInterviewRepository } from "@/adapters/supabase/interview-repository";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createCurrentInterviewGetHandler } from "@/app/api/v1/interview-sessions/handler";
import { parseServerConfig } from "@/lib/config/server";
import { getCurrentInterview } from "@/services/interview/interview-service";

export async function GET(): Promise<Response> {
  const config = parseServerConfig(process.env);
  const dependencies = {
    interviews: createSupabaseInterviewRepository(config),
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(
      config,
      toSupabaseCookieMethods(await cookies()),
    ),
  };
  return createCurrentInterviewGetHandler({
    current: () => getCurrentInterview(dependencies),
  })();
}
