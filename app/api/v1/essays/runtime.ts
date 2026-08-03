import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseEssayWorkspaceRepository } from "@/adapters/supabase/essay-workspace-repository";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { parseServerConfig } from "@/lib/config/server";

export async function createEssayWorkspaceRuntime() {
  const config = parseServerConfig(process.env);
  return {
    config,
    dependencies: {
      cursorSecret: config.hmacSecrets.idempotency,
      essays: createSupabaseEssayWorkspaceRepository(config),
      hmacSecrets: config.hmacSecrets,
      profiles: createSupabaseProfileRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
    },
  };
}
