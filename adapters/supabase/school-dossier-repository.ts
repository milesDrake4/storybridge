import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  schoolDossierSchema,
  schoolDossierSourceSchema,
  type SchoolDossier,
} from "@/contracts/domain/school-dossier";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CommitSchoolDossierDecision,
  SchoolDossierRepository,
} from "@/repositories/school-dossier-repository";

const sourceRowSchema = z.object({
  category: z.string(),
  claim: z.string(),
  id: z.string(),
  normalized_url: z.string(),
  retrieved_at: z.string(),
  supporting_excerpt: z.string(),
  title: z.string(),
});

const dossierRowSchema = z.object({
  created_at: z.string(),
  essay_id: z.string(),
  id: z.string(),
  schema_version: z.string(),
  school_id: z.string(),
  sources: z.array(sourceRowSchema),
  summary: z.string(),
  updated_at: z.string(),
  user_id: z.string(),
});

const commitResultSchema = z.object({
  decision: z.enum(["CREATED", "NOT_FOUND", "REPLAY", "STATE_CONFLICT"]),
  dossier: z.unknown().nullable(),
});

function timestamp(value: string): string {
  return new Date(value).toISOString();
}

function mapDossier(value: unknown): SchoolDossier {
  const row = dossierRowSchema.parse(value);
  return schoolDossierSchema.parse({
    createdAt: timestamp(row.created_at),
    essayId: row.essay_id,
    id: row.id,
    schemaVersion: row.schema_version,
    schoolId: row.school_id,
    sources: row.sources.map((source) =>
      schoolDossierSourceSchema.parse({
        category: source.category,
        claim: source.claim,
        id: source.id,
        normalizedUrl: source.normalized_url,
        retrievedAt: timestamp(source.retrieved_at),
        supportingExcerpt: source.supporting_excerpt,
        title: source.title,
      }),
    ),
    summary: row.summary,
    updatedAt: timestamp(row.updated_at),
    userId: row.user_id,
  });
}

export function createSupabaseSchoolDossierRepository(
  config: ServerConfig,
): SchoolDossierRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_school_dossier", {
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
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = commitResultSchema.parse(data);
      if (
        result.decision === "NOT_FOUND" ||
        result.decision === "STATE_CONFLICT"
      ) {
        return { type: result.decision } satisfies CommitSchoolDossierDecision;
      }
      if (!result.dossier) throw new Error("Dossier commit result is missing");
      return {
        type: result.decision,
        value: mapDossier(result.dossier),
      } satisfies CommitSchoolDossierDecision;
    },
    async findByEssay(userId, essayId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_school_dossier_for_essay", {
          requested_essay_id: essayId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapDossier(data) : null;
    },
    async findById(userId, dossierId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_school_dossier", {
          requested_dossier_id: dossierId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data ? mapDossier(data) : null;
    },
  };
}
