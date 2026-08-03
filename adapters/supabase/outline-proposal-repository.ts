import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  outlineProposalSchema,
  type OutlineProposal,
} from "@/contracts/http/v1/outlines";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CommitOutlineProposalDecision,
  OutlineProposalRepository,
} from "@/repositories/outline-proposal-repository";

const rowSchema = z.object({
  created_at: z.string(),
  essay_id: z.string(),
  expires_at: z.string(),
  id: z.string(),
  kind: z.literal("OUTLINE"),
  outline: z.unknown(),
  rationale: z.string(),
  selected_angle_id: z.string(),
  status: z.enum(["PENDING", "EXPIRED"]),
  target_revision: z.number(),
  user_id: z.string(),
});
const resultSchema = z.object({
  decision: z.enum([
    "CREATED",
    "EVIDENCE_INVALID",
    "NOT_FOUND",
    "REPLAY",
    "REVISION_MISMATCH",
    "STATE_CONFLICT",
  ]),
  proposal: z.unknown().nullable(),
});

function mapProposal(value: unknown): OutlineProposal {
  const row = rowSchema.parse(value);
  return outlineProposalSchema.parse({
    canAccept: false,
    createdAt: new Date(row.created_at).toISOString(),
    essayId: row.essay_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    id: row.id,
    kind: row.kind,
    outline: row.outline,
    rationale: row.rationale,
    selectedAngleId: row.selected_angle_id,
    status: row.status,
    targetRevision: row.target_revision,
    userId: row.user_id,
  });
}

export function createSupabaseOutlineProposalRepository(
  config: ServerConfig,
): OutlineProposalRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_outline_proposal", {
          requested_angle_id: input.angleId,
          requested_at: input.now.toISOString(),
          requested_dossier_id: input.dossierId,
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
        return {
          type: result.decision,
        } satisfies CommitOutlineProposalDecision;
      }
      if (!result.proposal) throw new Error("Outline proposal is missing");
      return {
        type: result.decision,
        value: mapProposal(result.proposal),
      } satisfies CommitOutlineProposalDecision;
    },
    async findById(userId, proposalId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_outline_proposal", {
          requested_proposal_id: proposalId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapProposal(data) : null;
    },
  };
}
