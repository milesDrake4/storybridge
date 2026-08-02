import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database, Json } from "@/adapters/supabase/database.types";
import {
  mapInterviewMessageRow,
  mapInterviewSessionRow,
} from "@/adapters/supabase/interview-repository";
import {
  storyProfileSchema,
  type StoryProfile,
} from "@/contracts/domain/story-vault";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CreateStoryProfileDecision,
  StoryVaultRepository,
} from "@/repositories/story-vault-repository";

type ProfileRow = Database["public"]["Tables"]["story_profiles"]["Row"];

const profileRowSchema = z.object({
  created_at: z.string(),
  excluded_topics: z.unknown(),
  id: z.string(),
  revision: z.number().int(),
  source_session_id: z.string(),
  status: z.string(),
  updated_at: z.string(),
  user_id: z.string(),
  version: z.number().int(),
  voice_profile: z.unknown(),
});

const createResultSchema = z.object({
  decision: z.enum([
    "CREATED",
    "REPLAY",
    "NOT_FOUND",
    "INCOMPLETE",
    "INSUFFICIENT_COVERAGE",
  ]),
  profile: profileRowSchema.nullable(),
});

function utc(value: string): string {
  return new Date(value).toISOString();
}

export function mapStoryProfileRow(row: ProfileRow): StoryProfile {
  return storyProfileSchema.parse({
    createdAt: utc(row.created_at),
    excludedTopics: row.excluded_topics,
    id: row.id,
    revision: row.revision,
    sourceSessionId: row.source_session_id,
    status: row.status,
    updatedAt: utc(row.updated_at),
    userId: row.user_id,
    version: row.version,
    voiceProfile: row.voice_profile,
  });
}

function mapCreateResult(value: unknown): CreateStoryProfileDecision {
  const result = createResultSchema.parse(value);
  if (result.decision === "CREATED" || result.decision === "REPLAY") {
    if (!result.profile) throw new Error("Story profile result is missing");
    return {
      profile: mapStoryProfileRow(result.profile as ProfileRow),
      type: result.decision,
    };
  }
  return { type: result.decision };
}

export function createSupabaseStoryVaultRepository(
  config: ServerConfig,
): StoryVaultRepository {
  const client = createSupabaseSecretClient(config);

  return {
    async create(input) {
      const extraction = {
        facts: input.facts.map((fact) => ({
          category: fact.category,
          contentHmac: fact.contentHmac,
          details: fact.details,
          sourceMessageIds: fact.sourceMessageIds,
          summary: fact.summary,
        })),
        voiceProfile: input.voiceProfile,
      } satisfies Json;
      const { data, error } = await client
        .schema("private")
        .rpc("create_story_profile", {
          requested_at: input.now.toISOString(),
          requested_extraction: extraction,
          requested_session_id: input.sessionId,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      return mapCreateResult(data);
    },

    async findById(userId, profileId) {
      const { data, error } = await client
        .from("story_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("id", profileId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapStoryProfileRow(data) : null;
    },

    async findBySession(userId, sessionId) {
      const { data, error } = await client
        .from("story_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("source_session_id", sessionId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapStoryProfileRow(data) : null;
    },

    async getInterview(userId, sessionId) {
      const { data: session, error: sessionError } = await client
        .from("interview_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("id", sessionId)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return null;

      const { data: messages, error: messagesError } = await client
        .from("interview_messages")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .order("sequence", { ascending: true });
      if (messagesError) throw messagesError;
      return {
        ...mapInterviewSessionRow(session),
        messages: (messages ?? []).map(mapInterviewMessageRow),
      };
    },
  };
}
