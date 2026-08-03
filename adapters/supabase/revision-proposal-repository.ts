import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  continuationProposalSchema,
  rewriteProposalSchema,
  type ContinuationProposal,
  type RewriteProposal,
} from "@/contracts/http/v1/proposals";
import type { ServerConfig } from "@/lib/config/server";
import type { RevisionProposalRepository } from "@/repositories/revision-proposal-repository";

const rowSchema = z.object({
  context_hash: z.string().nullable(),
  created_at: z.string(),
  cursor_offset: z.number().nullable(),
  essay_id: z.string(),
  expires_at: z.string(),
  id: z.string(),
  kind: z.enum(["REWRITE", "CONTINUATION"]),
  proposed_content: z.unknown(),
  rewrite_instruction: z.string().nullable(),
  selection_end: z.number().nullable(),
  selection_start: z.number().nullable(),
  selection_text_hash: z.string().nullable(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"]),
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

function common(row: z.infer<typeof rowSchema>) {
  return {
    canAccept: true as const,
    createdAt: new Date(row.created_at).toISOString(),
    essayId: row.essay_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    id: row.id,
    status: row.status,
    targetRevision: row.target_revision,
    userId: row.user_id,
  };
}

function mapRewrite(value: unknown): RewriteProposal {
  const row = rowSchema.parse(value);
  return rewriteProposalSchema.parse({
    ...common(row),
    ...z
      .object({
        claims: z.unknown(),
        proposedText: z.unknown(),
        rationale: z.unknown(),
      })
      .parse(row.proposed_content),
    instruction: row.rewrite_instruction,
    kind: "REWRITE",
    selection: {
      end: row.selection_end,
      start: row.selection_start,
      textHash: row.selection_text_hash,
    },
  });
}

function mapContinuation(value: unknown): ContinuationProposal {
  const row = rowSchema.parse(value);
  return continuationProposalSchema.parse({
    ...common(row),
    ...z.object({ suggestions: z.unknown() }).parse(row.proposed_content),
    contextHash: row.context_hash,
    cursorOffset: row.cursor_offset,
    kind: "CONTINUATION",
  });
}

export function createSupabaseRevisionProposalRepository(
  config: ServerConfig,
): RevisionProposalRepository {
  const client = createSupabaseSecretClient(config);
  const commit = async (
    input:
      | Parameters<RevisionProposalRepository["commitRewrite"]>[0]
      | Parameters<RevisionProposalRepository["commitContinuation"]>[0],
    kind: "REWRITE" | "CONTINUATION",
  ) => {
    const rewrite = "selection" in input;
    const { data, error } = await client
      .schema("private")
      .rpc("commit_revision_proposal", {
        requested_at: input.now.toISOString(),
        requested_context_hash: rewrite ? null : input.contextHash,
        requested_cursor_offset: rewrite ? null : input.cursorOffset,
        requested_draft: input.draft,
        requested_essay_id: input.essayId,
        requested_final_cost_cents: input.finalCostCents,
        requested_input_tokens: input.inputTokens,
        requested_kind: kind,
        requested_latency_ms: input.latencyMs,
        requested_model_id: input.modelId,
        requested_operation_id: input.operationId,
        requested_output_tokens: input.outputTokens,
        requested_provider_request_id: input.providerRequestId,
        requested_rewrite_instruction: rewrite ? input.instruction : null,
        requested_selection_end: rewrite ? input.selection.end : null,
        requested_selection_start: rewrite ? input.selection.start : null,
        requested_selection_text_hash: rewrite
          ? input.selection.textHash
          : null,
        requested_target_revision: input.targetRevision,
        requested_user_id: input.userId,
      });
    if (error) throw error;
    return resultSchema.parse(data);
  };
  const find = async (
    userId: Parameters<RevisionProposalRepository["findRewriteById"]>[0],
    proposalId: Parameters<RevisionProposalRepository["findRewriteById"]>[1],
    kind: "REWRITE" | "CONTINUATION",
  ) => {
    const { data, error } = await client
      .schema("private")
      .rpc("get_revision_proposal", {
        requested_kind: kind,
        requested_proposal_id: proposalId,
        requested_user_id: userId,
      });
    if (error) throw error;
    return data;
  };
  return {
    async commitContinuation(input) {
      const result = await commit(input, "CONTINUATION");
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision };
      }
      if (!result.proposal) throw new Error("Continuation proposal is missing");
      return { type: result.decision, value: mapContinuation(result.proposal) };
    },
    async commitRewrite(input) {
      const result = await commit(input, "REWRITE");
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision };
      }
      if (!result.proposal) throw new Error("Rewrite proposal is missing");
      return { type: result.decision, value: mapRewrite(result.proposal) };
    },
    async findContinuationById(userId, proposalId) {
      const data = await find(userId, proposalId, "CONTINUATION");
      return data ? mapContinuation(data) : null;
    },
    async findRewriteById(userId, proposalId) {
      const data = await find(userId, proposalId, "REWRITE");
      return data ? mapRewrite(data) : null;
    },
  };
}
