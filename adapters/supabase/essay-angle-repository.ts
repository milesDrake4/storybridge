import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  essayAngleSchema,
  type EssayAngle,
} from "@/contracts/domain/essay-angle";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CommitEssayAnglesDecision,
  EssayAngleRepository,
} from "@/repositories/essay-angle-repository";

const rowSchema = z.object({
  created_at: z.string(),
  dossier_id: z.string(),
  essay_id: z.string(),
  id: z.string(),
  position: z.number(),
  prompt_fit: z.string(),
  risk: z.string(),
  school_source_ids: z.array(z.string()),
  selected_at: z.string().nullable(),
  story_fact_ids: z.array(z.string()),
  thesis: z.string(),
  title: z.string(),
  updated_at: z.string(),
  user_id: z.string(),
});

const resultSchema = z.object({
  angles: z.unknown().nullable(),
  decision: z.enum([
    "CREATED",
    "DOSSIER_CHANGED",
    "EVIDENCE_INVALID",
    "NOT_FOUND",
    "REGENERATION_USED",
    "REPLAY",
    "STATE_CONFLICT",
  ]),
});

function mapAngle(value: unknown): EssayAngle {
  const row = rowSchema.parse(value);
  return essayAngleSchema.parse({
    createdAt: new Date(row.created_at).toISOString(),
    dossierId: row.dossier_id,
    essayId: row.essay_id,
    id: row.id,
    position: row.position,
    promptFit: row.prompt_fit,
    risk: row.risk,
    schoolSourceIds: row.school_source_ids,
    selectedAt: row.selected_at
      ? new Date(row.selected_at).toISOString()
      : null,
    storyFactIds: row.story_fact_ids,
    thesis: row.thesis,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
    userId: row.user_id,
  });
}

function mapAngles(value: unknown): [EssayAngle, EssayAngle, EssayAngle] {
  const rows = z.array(z.unknown()).length(3).parse(value).map(mapAngle);
  return [rows[0], rows[1], rows[2]];
}

export function createSupabaseEssayAngleRepository(
  config: ServerConfig,
): EssayAngleRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async commit(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("commit_essay_angles", {
          requested_angles: input.angles,
          requested_at: input.now.toISOString(),
          requested_dossier_id: input.dossierId,
          requested_essay_id: input.essayId,
          requested_final_cost_cents: input.finalCostCents,
          requested_input_tokens: input.inputTokens,
          requested_latency_ms: input.latencyMs,
          requested_model_id: input.modelId,
          requested_operation_id: input.operationId,
          requested_output_tokens: input.outputTokens,
          requested_provider_request_id: input.providerRequestId,
          requested_regenerate: input.regenerate,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = resultSchema.parse(data);
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision } satisfies CommitEssayAnglesDecision;
      }
      return {
        type: result.decision,
        value: mapAngles(result.angles),
      } satisfies CommitEssayAnglesDecision;
    },
    async list(userId, essayId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_essay_angles", {
          requested_essay_id: essayId,
          requested_operation_id: null,
          requested_user_id: userId,
        });
      if (error) throw error;
      return z.array(z.unknown()).parse(data).map(mapAngle);
    },
  };
}
