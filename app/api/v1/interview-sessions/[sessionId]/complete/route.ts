import { cookies } from "next/headers";

import { createConfiguredOpenAiAdapters } from "@/adapters/openai/client";
import { createSupabaseAiOperationRepository } from "@/adapters/supabase/ai-operation-repository";
import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createSupabaseStoryVaultRepository } from "@/adapters/supabase/story-vault-repository";
import { createInterviewCompletePostHandler } from "@/app/api/v1/interview-sessions/[sessionId]/complete/handler";
import { parseServerConfig } from "@/lib/config/server";
import { extractStoryProfile } from "@/services/story-vault/extract-profile";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const config = parseServerConfig(process.env);
  const dependencies = {
    aiOperations: createSupabaseAiOperationRepository(config),
    hmacSecrets: config.hmacSecrets,
    limits: {
      betaAccountCap: config.betaAccountCap,
      dailyAiCallLimit: config.dailyAiCallLimit,
      monthlyOpenAiBudgetCents: config.monthlyOpenAiBudgetCents,
    },
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(
      config,
      toSupabaseCookieMethods(await cookies()),
    ),
    structured: createConfiguredOpenAiAdapters(config).structured,
    vault: createSupabaseStoryVaultRepository(config),
  };
  const { sessionId } = await context.params;
  return createInterviewCompletePostHandler({
    appUrl: config.appUrl,
    complete: (id, extractionRequest) =>
      extractStoryProfile(id, extractionRequest, dependencies),
  })(request, sessionId);
}
