import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  referenceDraftProposalSchema,
  type ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";
import type { ServerConfig } from "@/lib/config/server";
import type { ReferenceDraftRepository } from "@/repositories/reference-draft-repository";

const claimRowSchema = z.object({
  content_hmac: z.string(),
  end: z.number().int(),
  id: z.string(),
  school_source_ids: z.array(z.string()),
  start: z.number().int(),
  status: z.literal("SUPPORTED"),
  story_fact_ids: z.array(z.string()),
  text: z.string(),
});
const rowSchema = z.object({
  acknowledgment_version: z.string(),
  claims: z.array(claimRowSchema),
  created_at: z.string(),
  essay_id: z.string(),
  expires_at: z.string(),
  id: z.string(),
  kind: z.literal("REFERENCE_DRAFT"),
  rationale: z.string(),
  reference_text: z.string(),
  status: z.enum(["PENDING", "EXPIRED"]),
  target_revision: z.number().int(),
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

function mapProposal(value: unknown): ReferenceDraftProposal {
  const row = rowSchema.parse(value);
  return referenceDraftProposalSchema.parse({
    acknowledgmentVersion: row.acknowledgment_version,
    canAccept: false,
    claims: row.claims.map((claim) => ({
      contentHmac: claim.content_hmac,
      end: claim.end,
      id: claim.id,
      schoolSourceIds: claim.school_source_ids,
      start: claim.start,
      status: claim.status,
      storyFactIds: claim.story_fact_ids,
      text: claim.text,
    })),
    createdAt: new Date(row.created_at).toISOString(),
    essayId: row.essay_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    id: row.id,
    kind: row.kind,
    rationale: row.rationale,
    referenceText: row.reference_text,
    status: row.status,
    targetRevision: row.target_revision,
    userId: row.user_id,
  });
}

export function createSupabaseReferenceDraftRepository(
  config: ServerConfig,
): ReferenceDraftRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_reference_draft_proposal", {
          requested_acknowledgment_version: input.acknowledgmentVersion,
          requested_at: input.now.toISOString(),
          requested_draft: {
            claims: input.claims,
            rationale: input.rationale,
            referenceText: input.referenceText,
          },
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
      if (!result.proposal) throw new Error("Reference proposal is missing");
      return { type: result.decision, value: mapProposal(result.proposal) };
    },
    async findById(userId, proposalId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_reference_draft_proposal", {
          requested_proposal_id: proposalId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapProposal(data) : null;
    },
  };
}
