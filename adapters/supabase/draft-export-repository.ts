import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { ServerConfig } from "@/lib/config/server";
import type {
  DraftExportDecision,
  DraftExportRepository,
} from "@/repositories/draft-export-repository";

const resultSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("EXPORTABLE"), draft_text: z.string() }),
  z.object({
    decision: z.enum(["BLOCKED", "NOT_FOUND"]),
    draft_text: z.null(),
  }),
]);

export function createSupabaseDraftExportRepository(
  config: ServerConfig,
): DraftExportRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async get(userId, essayId): Promise<DraftExportDecision> {
      const { data, error } = await client
        .schema("private")
        .rpc("get_student_draft_export", {
          requested_essay_id: essayId,
          requested_user_id: userId,
        });
      if (error) throw error;
      const result = resultSchema.parse(data);
      return result.decision === "EXPORTABLE"
        ? { draftText: result.draft_text, type: "EXPORTABLE" }
        : { type: result.decision };
    },
  };
}
