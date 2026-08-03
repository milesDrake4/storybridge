import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database } from "@/adapters/supabase/database.types";
import { mapEssay } from "@/adapters/supabase/essay-workspace-repository";
import type { ServerConfig } from "@/lib/config/server";
import type { EssayVersionRepository } from "@/repositories/essay-version-repository";

type EssayRow = Database["public"]["Tables"]["essays"]["Row"];

const saveResultSchema = z.object({
  decision: z.enum([
    "NOT_FOUND",
    "REVISION_MISMATCH",
    "STATE_CONFLICT",
    "UNCHANGED",
    "UPDATED",
  ]),
  essay: z.unknown().nullable(),
});

export function createSupabaseEssayVersionRepository(
  config: ServerConfig,
): EssayVersionRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async save(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("save_essay_draft", {
          requested_accepted_proposal_id: input.acceptedProposalId,
          requested_at: input.now.toISOString(),
          requested_draft_text: input.draftText ?? null,
          requested_essay_id: input.essayId,
          requested_expected_revision: input.expectedRevision,
          requested_origin: input.origin,
          requested_outline: input.outline ?? null,
          requested_status: input.status ?? null,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = saveResultSchema.parse(data);
      if (
        result.decision === "NOT_FOUND" ||
        result.decision === "REVISION_MISMATCH" ||
        result.decision === "STATE_CONFLICT"
      ) {
        return { type: result.decision };
      }
      if (!result.essay) throw new Error("Saved essay is missing");
      return {
        type: result.decision,
        value: mapEssay(result.essay as EssayRow),
      };
    },
  };
}
