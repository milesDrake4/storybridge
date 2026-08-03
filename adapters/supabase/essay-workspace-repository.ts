import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database, Json } from "@/adapters/supabase/database.types";
import {
  essaySchema,
  essayWorkspaceSchema,
  type EssayWorkspace,
} from "@/contracts/http/v1/essays";
import { schoolSummarySchema } from "@/contracts/http/v1/schools";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CreateEssayWorkspaceDecision,
  EssayWorkspaceRepository,
} from "@/repositories/essay-workspace-repository";

type EssayRow = Database["public"]["Tables"]["essays"]["Row"];

const createResultSchema = z.object({
  decision: z.enum([
    "CREATED",
    "IDEMPOTENCY_KEY_REUSED",
    "NOT_ELIGIBLE",
    "QUOTA_EXCEEDED",
    "REPLAY",
    "REPLAY_DELETED",
    "UNSUPPORTED_SCHOOL",
  ]),
  essay: z.unknown().nullable(),
});

const workspaceResultSchema = z.object({
  essay: z.unknown(),
  school: z.unknown(),
});

function timestamp(value: string): string {
  return new Date(value).toISOString();
}

function mapEssay(row: EssayRow) {
  return essaySchema.parse({
    createdAt: timestamp(row.created_at),
    dossierId: row.dossier_id,
    id: row.id,
    prompt: row.prompt,
    revision: row.revision,
    schoolId: row.school_id,
    selectedAngleId: row.selected_angle_id,
    season: row.season,
    status: row.status,
    updatedAt: timestamp(row.updated_at),
    userId: row.user_id,
    wordLimit: row.word_limit,
  });
}

function mapSchool(value: unknown) {
  const row = z
    .object({
      canonical_name: z.string(),
      id: z.string(),
      official_domain: z.string(),
    })
    .parse(value);
  return schoolSummarySchema.parse({
    canonicalName: row.canonical_name,
    id: row.id,
    officialDomain: row.official_domain,
  });
}

function mapWorkspace(value: unknown): EssayWorkspace {
  const row = workspaceResultSchema.parse(value);
  return essayWorkspaceSchema.parse({
    essay: mapEssay(row.essay as EssayRow),
    school: mapSchool(row.school),
  });
}

export function createSupabaseEssayWorkspaceRepository(
  config: ServerConfig,
): EssayWorkspaceRepository {
  const client = createSupabaseSecretClient(config);

  async function getWorkspace(
    userId: string,
    essayId: string,
  ): Promise<EssayWorkspace | null> {
    const { data, error } = await client
      .schema("private")
      .rpc("get_essay_workspace", {
        requested_essay_id: essayId,
        requested_user_id: userId,
      });
    if (error) throw error;
    return data ? mapWorkspace(data) : null;
  }

  return {
    async create(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("create_essay_workspace", {
          requested_at: input.now.toISOString(),
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_prompt: input.prompt,
          requested_request_hmac: input.requestHmac,
          requested_school_id: input.schoolId,
          requested_season: input.season,
          requested_user_id: input.userId,
          requested_word_limit: input.wordLimit,
        });
      if (error) throw error;
      const result = createResultSchema.parse(data);
      if (result.decision !== "CREATED" && result.decision !== "REPLAY") {
        return { type: result.decision } satisfies CreateEssayWorkspaceDecision;
      }
      const essay = essaySchema.parse(mapEssay(result.essay as EssayRow));
      const workspace = await getWorkspace(input.userId, essay.id);
      if (!workspace) throw new Error("Created essay workspace is missing");
      return { type: result.decision, value: workspace };
    },
    async delete(userId, essayId) {
      const { data, error } = await client
        .schema("private")
        .rpc("delete_essay_workspace", {
          requested_essay_id: essayId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return data;
    },
    get: getWorkspace,
    async list(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("list_essay_workspaces", {
          requested_after_id: input.after?.id ?? null,
          requested_after_updated_at: input.after?.updatedAt ?? null,
          requested_limit: input.limit,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      return (data ?? []).map((row: { essay: Json; school: Json }) =>
        mapWorkspace(row),
      );
    },
  };
}
