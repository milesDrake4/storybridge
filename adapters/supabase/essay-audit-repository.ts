import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  canonicalUuidSchema,
  essayIdSchema,
  proposalClaimIdSchema,
} from "@/contracts/domain/ids";
import {
  essayAuditSchema,
  similarityMetricsSchema,
  type EssayAudit,
} from "@/contracts/http/v1/audits";
import type { ServerConfig } from "@/lib/config/server";
import type { ContentHmac } from "@/lib/security/hmac";
import type {
  AuditContext,
  CommitEssayAuditResult,
  EssayAuditRepository,
} from "@/repositories/essay-audit-repository";

const versionSchema = z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/);
const contextSchema = z.object({
  essay: z.object({
    draft_text: z.string(),
    id: essayIdSchema,
    prompt: z.string(),
    revision: z.number().int(),
    word_limit: z.number().int(),
  }),
  evidence_manifest_version: versionSchema,
  has_voice_profile: z.boolean(),
  invalid_evidence_ids: z.array(canonicalUuidSchema),
  reference_draft: z
    .object({
      claims: z.array(
        z.object({
          decision: z.enum(["CONFIRMED", "REJECTED"]).nullable(),
          id: proposalClaimIdSchema,
          text: z.string(),
        }),
      ),
      reference_text: z.string(),
    })
    .nullable(),
  school_source_ids: z.array(canonicalUuidSchema),
  story_fact_ids: z.array(canonicalUuidSchema),
  unsupported_claims: z.array(
    z.object({
      evidence_ids: z.array(canonicalUuidSchema),
      text: z.string(),
    }),
  ),
});
const auditRowSchema = z.object({
  created_at: z.string(),
  essay_id: z.string(),
  essay_revision: z.number().int(),
  evidence_manifest_version: z.string(),
  id: z.string(),
  issues: z.unknown(),
  similarity: z.unknown(),
  status: z.enum(["PASS", "BLOCKED"]),
  user_id: z.string(),
});
const commitResultSchema = z.object({
  audit: z.unknown().nullable(),
  decision: z.enum([
    "CREATED",
    "IDEMPOTENCY_KEY_REUSED",
    "MANIFEST_MISMATCH",
    "NOT_FOUND",
    "REPLAY",
    "REVISION_MISMATCH",
  ]),
});

function mapContext(value: unknown): AuditContext {
  const row = contextSchema.parse(value);
  return {
    essay: {
      draftText: row.essay.draft_text,
      id: row.essay.id,
      prompt: row.essay.prompt,
      revision: row.essay.revision,
      wordLimit: row.essay.word_limit,
    },
    evidenceManifestVersion: row.evidence_manifest_version as ContentHmac,
    hasVoiceProfile: row.has_voice_profile,
    invalidEvidenceIds: row.invalid_evidence_ids,
    referenceDraft: row.reference_draft
      ? {
          claims: row.reference_draft.claims.map((claim) => ({
            decision: claim.decision,
            id: claim.id,
            text: claim.text,
          })),
          referenceText: row.reference_draft.reference_text,
        }
      : null,
    schoolSourceIds: row.school_source_ids,
    storyFactIds: row.story_fact_ids,
    unsupportedClaims: row.unsupported_claims.map((claim) => ({
      evidenceIds: claim.evidence_ids,
      text: claim.text,
    })),
  };
}

function mapAudit(value: unknown): EssayAudit {
  const row = auditRowSchema.parse(value);
  return essayAuditSchema.parse({
    createdAt: new Date(row.created_at).toISOString(),
    essayId: row.essay_id,
    essayRevision: row.essay_revision,
    evidenceManifestVersion: row.evidence_manifest_version,
    id: row.id,
    issues: row.issues,
    similarity: similarityMetricsSchema.parse(row.similarity),
    status: row.status,
    userId: row.user_id,
  });
}

export function createSupabaseEssayAuditRepository(
  config: ServerConfig,
): EssayAuditRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async loadContext(userId, essayId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_essay_audit_context", {
          requested_essay_id: essayId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapContext(data) : null;
    },
    async commit(input): Promise<CommitEssayAuditResult> {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_essay_audit", {
          requested_at: input.now.toISOString(),
          requested_audit_id: input.auditId,
          requested_essay_id: input.essayId,
          requested_essay_revision: input.essayRevision,
          requested_evidence_manifest_version: input.evidenceManifestVersion,
          requested_expected_draft_text: input.expectedDraftText,
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_issues: input.issues,
          requested_request_hmac: input.requestHmac,
          requested_similarity: input.similarity,
          requested_status: input.status,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = commitResultSchema.parse(data);
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision };
      }
      if (!result.audit) throw new Error("Committed essay audit is missing");
      return { type: result.decision, value: mapAudit(result.audit) };
    },
  };
}
