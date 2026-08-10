import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import { accountExportSchema } from "@/contracts/http/v1/me";
import type { ServerConfig } from "@/lib/config/server";
import type { AccountExportRepository } from "@/repositories/account-export-repository";

const accountExportResultSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("READY"), export: accountExportSchema }),
  z.strictObject({ decision: z.literal("TOO_LARGE") }),
]);

export function createSupabaseAccountExportRepository(
  config: ServerConfig,
): AccountExportRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async get(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_account_export", {
          requested_at: input.at.toISOString(),
          requested_max_bytes: input.maxBytes,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = accountExportResultSchema.parse(data);
      if (result.decision === "TOO_LARGE") return { type: "TOO_LARGE" };
      return { export: result.export, type: "READY" };
    },
  };
}
