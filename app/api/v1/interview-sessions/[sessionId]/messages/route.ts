import { cookies } from "next/headers";

import { createConfiguredOpenAiAdapters } from "@/adapters/openai/client";
import { createSupabaseAiOperationRepository } from "@/adapters/supabase/ai-operation-repository";
import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { createSupabaseInterviewRepository } from "@/adapters/supabase/interview-repository";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createInterviewAnswerPostHandler } from "@/app/api/v1/interview-sessions/handler";
import { parseServerConfig } from "@/lib/config/server";
import { answerInterview } from "@/services/interview/interview-service";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const config = parseServerConfig(process.env);
  const dependencies = {
    aiOperations: createSupabaseAiOperationRepository(config),
    hmacSecrets: config.hmacSecrets,
    interviews: createSupabaseInterviewRepository(config),
    limits: {
      betaAccountCap: config.betaAccountCap,
      dailyAiCallLimit: config.dailyAiCallLimit,
      monthlyOpenAiBudgetCents: config.monthlyOpenAiBudgetCents,
    },
    moderation: createConfiguredOpenAiAdapters(config).moderation,
    profiles: createSupabaseProfileRepository(config),
    session: createSupabaseAuthenticatedSession(
      config,
      toSupabaseCookieMethods(await cookies()),
    ),
  };
  const { sessionId } = await context.params;
  return createInterviewAnswerPostHandler({
    answer: (id, input, answerRequest) =>
      answerInterview(id, input, answerRequest, dependencies),
    appUrl: config.appUrl,
  })(request, sessionId);
}
