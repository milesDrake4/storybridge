import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  adviceProposalSchema,
  type AdviceProposal,
} from "@/contracts/http/v1/proposals";
import type { ServerConfig } from "@/lib/config/server";
import type { AdviceProposalRepository } from "@/repositories/advice-proposal-repository";

const rowSchema = z.object({
  created_at: z.string(),
  essay_id: z.string(),
  expires_at: z.string(),
  guidance: z.unknown(),
  headline: z.string(),
  id: z.string(),
  kind: z.literal("ADVICE"),
  rationale: z.string(),
  status: z.enum(["PENDING", "EXPIRED"]),
  target_revision: z.number(),
  user_id: z.string(),
});
const resultSchema = z.object({
  decision: z.enum([
    "CREATED",
    "NOT_FOUND",
    "REPLAY",
    "REVISION_MISMATCH",
    "STATE_CONFLICT",
  ]),
  proposal: z.unknown().nullable(),
});

function mapProposal(value: unknown): AdviceProposal {
  const row = rowSchema.parse(value);
  return adviceProposalSchema.parse({
    canAccept: false,
    createdAt: new Date(row.created_at).toISOString(),
    essayId: row.essay_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    guidance: row.guidance,
    headline: row.headline,
    id: row.id,
    kind: row.kind,
    rationale: row.rationale,
    status: row.status,
    targetRevision: row.target_revision,
    userId: row.user_id,
  });
}

export function createSupabaseAdviceProposalRepository(
  config: ServerConfig,
): AdviceProposalRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_advice_proposal", {
          requested_at: input.now.toISOString(),
          requested_draft: input.draft,
          requested_essay_id: input.essayId,
          requested_final_cost_cents: input.finalCostCents,
          requested_input_tokens: input.inputTokens,
          requested_latency_ms: input.latencyMs,
          requested_model_id: input.modelId,
          requested_operation_id: input.operationId,
          requested_output_tokens: input.outputTokens,
          requested_provider_request_id: input.providerRequestId,
          requested_target_revision: input.targetRevision,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = resultSchema.parse(data);
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision };
      }
      if (!result.proposal) throw new Error("Advice proposal is missing");
      return { type: result.decision, value: mapProposal(result.proposal) };
    },
    async findById(userId, proposalId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_advice_proposal", {
          requested_proposal_id: proposalId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapProposal(data) : null;
    },
  };
}
