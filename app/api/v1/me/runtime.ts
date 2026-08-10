import { cookies } from "next/headers";

import { createSupabaseAccountDeletionRepository } from "@/adapters/supabase/account-deletion-repository";
import { createSupabaseAccountExportRepository } from "@/adapters/supabase/account-export-repository";
import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { parseServerConfig } from "@/lib/config/server";
import { createAccountDeletionTokens } from "@/services/privacy/account-deletion-tokens";

export async function createAccountPrivacyRuntime() {
  const config = parseServerConfig(process.env);
  const deletionRepository = createSupabaseAccountDeletionRepository(config);
  return {
    config,
    dependencies: {
      deletions: deletionRepository,
      exports: createSupabaseAccountExportRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
      tokens: createAccountDeletionTokens(config.hmacSecrets),
    },
  };
}

export function createDeletionStatusRuntime() {
  const config = parseServerConfig(process.env);
  return {
    deletions: createSupabaseAccountDeletionRepository(config),
    tokens: createAccountDeletionTokens(config.hmacSecrets),
  };
}
