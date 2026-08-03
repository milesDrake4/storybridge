import { cookies } from "next/headers";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { createSupabaseSchoolRegistryRepository } from "@/adapters/supabase/school-registry-repository";
import { parseServerConfig } from "@/lib/config/server";

export async function createSchoolRegistryRuntime() {
  const config = parseServerConfig(process.env);
  return {
    config,
    dependencies: {
      cursorSecret: config.hmacSecrets.idempotency,
      hmacSecrets: config.hmacSecrets,
      profiles: createSupabaseProfileRepository(config),
      schools: createSupabaseSchoolRegistryRepository(config),
      session: createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
    },
  };
}
