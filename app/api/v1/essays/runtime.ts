import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseEssayWorkspaceRepository } from "@/adapters/supabase/essay-workspace-repository";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createSupabaseAiOperationRepository } from "@/adapters/supabase/ai-operation-repository";
import { createSupabaseSchoolDossierRepository } from "@/adapters/supabase/school-dossier-repository";
import { createSdkOpenAiTransport } from "@/adapters/openai/client";
import { createSchoolResearchAdapter } from "@/adapters/openai/school-research";
import { parseServerConfig } from "@/lib/config/server";

export async function createEssayWorkspaceRuntime() {
  const config = parseServerConfig(process.env);
  const transport = createSdkOpenAiTransport(config.openAiApiKey);
  return {
    config,
    dependencies: {
      aiOperations: createSupabaseAiOperationRepository(config),
      cursorSecret: config.hmacSecrets.idempotency,
      essays: createSupabaseEssayWorkspaceRepository(config),
      dossiers: createSupabaseSchoolDossierRepository(config),
      hmacSecrets: config.hmacSecrets,
      profiles: createSupabaseProfileRepository(config),
      research: createSchoolResearchAdapter(
        {
          contentHmacSecret: config.hmacSecrets.content,
          maxOutputTokens: config.maxAiOutputTokens,
          model: config.openAiModel,
        },
        transport,
      ),
      limits: {
        betaAccountCap: config.betaAccountCap,
        dailyAiCallLimit: config.dailyAiCallLimit,
        monthlyOpenAiBudgetCents: config.monthlyOpenAiBudgetCents,
      },
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
    },
  };
}
