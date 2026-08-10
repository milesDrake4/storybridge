import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import { billingEntitlementSchema } from "@/contracts/http/v1/billing";
import type { ServerConfig } from "@/lib/config/server";
import type { EntitlementRepository } from "@/repositories/entitlement-repository";

const entitlementRowSchema = z.object({
  essay_limit: z.number().int(),
  essays_remaining: z.number().int(),
  essays_used: z.number().int(),
  kind: z.enum(["FREE", "SEASON_PASS"]),
  season: z.string(),
  season_pass_status: z
    .enum(["ACTIVE", "EXPIRED", "REFUNDED", "REVOKED"])
    .nullable(),
  status: z.enum(["ACTIVE", "EXPIRED", "REFUNDED", "REVOKED"]),
});

export function createSupabaseEntitlementRepository(
  config: ServerConfig,
): EntitlementRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async getCurrent(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_billing_entitlement", {
          requested_at: input.at.toISOString(),
          requested_default_free_limit: config.freeEssayLimit,
          requested_season: input.season,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const row = entitlementRowSchema.parse(data);
      return billingEntitlementSchema.parse({
        essayLimit: row.essay_limit,
        essaysRemaining: row.essays_remaining,
        essaysUsed: row.essays_used,
        kind: row.kind,
        season: row.season,
        seasonPassStatus: row.season_pass_status,
        status: row.status,
      });
    },
  };
}
