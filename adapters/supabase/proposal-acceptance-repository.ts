import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database } from "@/adapters/supabase/database.types";
import { mapEssay } from "@/adapters/supabase/essay-workspace-repository";
import type { ServerConfig } from "@/lib/config/server";
import type { ProposalAcceptanceRepository } from "@/repositories/proposal-acceptance-repository";

type EssayRow = Database["public"]["Tables"]["essays"]["Row"];

const resultSchema = z.object({
  decision: z.enum([
    "ACCEPTED",
    "IDEMPOTENCY_KEY_REUSED",
    "NOT_FOUND",
    "PROPOSAL_NOT_ACCEPTABLE",
    "REPLAY",
    "REVISION_MISMATCH",
    "STATE_CONFLICT",
  ]),
  essay: z.unknown().nullable(),
});

function mapResult(value: unknown) {
  const result = resultSchema.parse(value);
  if (result.decision !== "ACCEPTED" && result.decision !== "REPLAY") {
    return { type: result.decision } as const;
  }
  if (!result.essay) throw new Error("Accepted essay is missing");
  return {
    type: result.decision,
    value: mapEssay(result.essay as EssayRow),
  } as const;
}

export function createSupabaseProposalAcceptanceRepository(
  config: ServerConfig,
): ProposalAcceptanceRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async accept(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("accept_revision_proposal", {
          requested_at: input.now.toISOString(),
          requested_essay_id: input.essayId,
          requested_expected_current_draft: input.expectedCurrentDraft,
          requested_expected_revision: input.expectedRevision,
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_next_draft: input.nextDraft,
          requested_proposal_id: input.proposalId,
          requested_request_hmac: input.requestHmac,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      return mapResult(data);
    },
    async replay(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("find_proposal_acceptance_replay", {
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_request_hmac: input.requestHmac,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      if (!data) return null;
      const result = resultSchema.parse(data);
      if (result.decision === "IDEMPOTENCY_KEY_REUSED") {
        return { type: "IDEMPOTENCY_KEY_REUSED" };
      }
      if (result.decision !== "REPLAY") {
        throw new Error("Unexpected acceptance replay decision");
      }
      if (!result.essay) throw new Error("Replayed essay is missing");
      return {
        type: "REPLAY",
        value: mapEssay(result.essay as EssayRow),
      };
    },
  };
}
