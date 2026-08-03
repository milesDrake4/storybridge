import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseEssayWorkspaceRepository } from "@/adapters/supabase/essay-workspace-repository";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createSupabaseAiOperationRepository } from "@/adapters/supabase/ai-operation-repository";
import { createSupabaseEssayAngleRepository } from "@/adapters/supabase/essay-angle-repository";
import { createSupabaseSchoolDossierRepository } from "@/adapters/supabase/school-dossier-repository";
import {
  createOpenAiAdapters,
  createSdkOpenAiTransport,
} from "@/adapters/openai/client";
import { createSchoolResearchAdapter } from "@/adapters/openai/school-research";
import { createAngleGenerationAdapter } from "@/adapters/openai/angle-generator";
import { createSupabaseStoryVaultRepository } from "@/adapters/supabase/story-vault-repository";
import { createSupabaseOutlineProposalRepository } from "@/adapters/supabase/outline-proposal-repository";
import { createOutlineGenerationAdapter } from "@/adapters/openai/outline-generator";
import { parseServerConfig } from "@/lib/config/server";

export async function createEssayWorkspaceRuntime() {
  const config = parseServerConfig(process.env);
  const transport = createSdkOpenAiTransport(config.openAiApiKey);
  const openAi = createOpenAiAdapters(
    {
      contentHmacSecret: config.hmacSecrets.content,
      maxOutputTokens: config.maxAiOutputTokens,
      model: config.openAiModel,
    },
    transport,
  );
  return {
    config,
    dependencies: {
      aiOperations: createSupabaseAiOperationRepository(config),
      angles: createSupabaseEssayAngleRepository(config),
      cursorSecret: config.hmacSecrets.idempotency,
      essays: createSupabaseEssayWorkspaceRepository(config),
      dossiers: createSupabaseSchoolDossierRepository(config),
      hmacSecrets: config.hmacSecrets,
      profiles: createSupabaseProfileRepository(config),
      generator: createAngleGenerationAdapter(openAi.structured),
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
      outlineGenerator: createOutlineGenerationAdapter(openAi.structured),
      outlineProposals: createSupabaseOutlineProposalRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
      vault: createSupabaseStoryVaultRepository(config),
    },
  };
}
