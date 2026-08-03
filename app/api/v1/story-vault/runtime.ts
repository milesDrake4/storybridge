import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createSupabaseStoryVaultRepository } from "@/adapters/supabase/story-vault-repository";
import { parseServerConfig } from "@/lib/config/server";

export async function createStoryVaultRuntime() {
  const config = parseServerConfig(process.env);
  return {
    config,
    dependencies: {
      hmacSecrets: config.hmacSecrets,
      profiles: createSupabaseProfileRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
      vault: createSupabaseStoryVaultRepository(config),
    },
  };
}
