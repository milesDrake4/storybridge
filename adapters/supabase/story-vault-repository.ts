import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database, Json } from "@/adapters/supabase/database.types";
import {
  mapInterviewMessageRow,
  mapInterviewSessionRow,
} from "@/adapters/supabase/interview-repository";
import {
  storyFactSchema,
  storyProfileSchema,
  storyProfileWithFactsSchema,
  type StoryFact,
  type StoryProfile,
} from "@/contracts/domain/story-vault";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CreateStoryProfileDecision,
  StoryVaultRepository,
} from "@/repositories/story-vault-repository";

type ProfileRow = Database["public"]["Tables"]["story_profiles"]["Row"];
type FactRow = Database["public"]["Tables"]["story_facts"]["Row"];

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

const factRowSchema = z.object({
  category: z.string(),
  content_hmac: z.string(),
  created_at: z.string(),
  details: z.unknown(),
  id: z.string(),
  profile_id: z.string(),
  revision: z.number().int(),
  summary: z.string(),
  suppressed_at: z.string().nullable(),
  updated_at: z.string(),
  user_id: z.string(),
  verification_status: z.string(),
  verified_at: z.string().nullable(),
});

const factMutationSchema = z.object({
  decision: z.enum(["UPDATED", "REPLAY", "NOT_FOUND", "REVISION_MISMATCH"]),
  fact: factRowSchema.nullable(),
});

const profileMutationSchema = z.object({
  decision: z.enum(["UPDATED", "NOT_FOUND", "REVISION_MISMATCH"]),
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

export function mapStoryFactRow(
  row: FactRow,
  sourceMessageIds: string[] = [],
): StoryFact {
  return storyFactSchema.parse({
    category: row.category,
    contentHmac: row.content_hmac,
    createdAt: utc(row.created_at),
    details: row.details,
    id: row.id,
    profileId: row.profile_id,
    revision: row.revision,
    sourceMessageIds,
    summary: row.summary,
    suppressedAt: row.suppressed_at ? utc(row.suppressed_at) : null,
    updatedAt: utc(row.updated_at),
    userId: row.user_id,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at ? utc(row.verified_at) : null,
  });
}

function mapFactMutation(value: unknown) {
  const result = factMutationSchema.parse(value);
  if (result.decision === "UPDATED") {
    if (!result.fact) throw new Error("Story fact result is missing");
    return { type: "UPDATED", value: result.fact as FactRow } as const;
  }
  if (result.decision === "REPLAY") {
    if (!result.fact) throw new Error("Story fact result is missing");
    return { type: "REPLAY", value: result.fact as FactRow } as const;
  }
  return { type: result.decision } as const;
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

  async function mapFactWithSources(row: FactRow): Promise<StoryFact> {
    const { data, error } = await client
      .from("story_fact_sources")
      .select("message_id")
      .eq("user_id", row.user_id)
      .eq("fact_id", row.id);
    if (error) throw error;
    return mapStoryFactRow(
      row,
      (data ?? []).map((source) => source.message_id),
    );
  }

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

    async getCurrent(userId) {
      const { data: profile, error: profileError } = await client
        .from("story_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return null;

      const { data: facts, error: factsError } = await client
        .from("story_facts")
        .select("*")
        .eq("user_id", userId)
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: true });
      if (factsError) throw factsError;

      const { data: sources, error: sourcesError } = await client
        .from("story_fact_sources")
        .select("fact_id,message_id")
        .eq("user_id", userId)
        .eq("profile_id", profile.id);
      if (sourcesError) throw sourcesError;
      const messageIds = [
        ...new Set((sources ?? []).map((row) => row.message_id)),
      ];
      const messagesResult = messageIds.length
        ? await client
            .from("interview_messages")
            .select("id,content,question_key")
            .eq("user_id", userId)
            .in("id", messageIds)
        : { data: [], error: null };
      if (messagesResult.error) throw messagesResult.error;

      return storyProfileWithFactsSchema.parse({
        facts: (facts ?? []).map((fact) => {
          const factSources = (sources ?? [])
            .filter((source) => source.fact_id === fact.id)
            .map((source) =>
              messagesResult.data?.find(
                (message) => message.id === source.message_id,
              ),
            )
            .filter((message) => message !== undefined)
            .map((message) => ({
              content: message.content,
              id: message.id,
              questionKey: message.question_key,
            }));
          return {
            ...mapStoryFactRow(
              fact,
              factSources.map((s) => s.id),
            ),
            sources: factSources,
          };
        }),
        profile: mapStoryProfileRow(profile),
      });
    },

    async updateProfile(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("update_story_profile", {
          requested_at: input.now.toISOString(),
          requested_excluded_topics: input.patch.excludedTopics ?? null,
          requested_expected_revision: input.expectedRevision,
          requested_profile_id: input.profileId,
          requested_user_id: input.userId,
          requested_voice_profile: input.patch.voiceProfile ?? null,
        });
      if (error) throw error;
      const result = profileMutationSchema.parse(data);
      if (result.decision === "UPDATED") {
        if (!result.profile) throw new Error("Story profile result is missing");
        return {
          type: "UPDATED",
          value: mapStoryProfileRow(result.profile as ProfileRow),
        };
      }
      return { type: result.decision };
    },

    async updateFact(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("update_story_fact", {
          requested_at: input.now.toISOString(),
          requested_content_hmac: input.contentHmac,
          requested_details: input.patch.details,
          requested_expected_revision: input.expectedRevision,
          requested_fact_id: input.factId,
          requested_summary: input.patch.summary,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = mapFactMutation(data);
      return result.type === "UPDATED" || result.type === "REPLAY"
        ? { type: result.type, value: await mapFactWithSources(result.value) }
        : result;
    },

    async verifyFact(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("set_story_fact_verification", {
          requested_at: input.now.toISOString(),
          requested_content_hmac: input.contentHmac,
          requested_decision: input.decision,
          requested_expected_revision: input.expectedRevision,
          requested_fact_id: input.factId,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = mapFactMutation(data);
      return result.type === "UPDATED" || result.type === "REPLAY"
        ? { type: result.type, value: await mapFactWithSources(result.value) }
        : result;
    },

    async suppressFact(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("set_story_fact_suppression", {
          requested_at: input.now.toISOString(),
          requested_fact_id: input.factId,
          requested_suppressed: input.suppressed,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = mapFactMutation(data);
      return result.type === "UPDATED" || result.type === "REPLAY"
        ? { type: result.type, value: await mapFactWithSources(result.value) }
        : result;
    },

    async deleteFact(userId, factId) {
      const { data, error } = await client
        .schema("private")
        .rpc("delete_story_fact", {
          requested_fact_id: factId,
          requested_user_id: userId,
        });
      if (error) throw error;
      return z.boolean().parse(data);
    },

    async getFactsForAi(userId) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_story_facts_for_ai", {
          requested_user_id: userId,
        });
      if (error) throw error;
      return Promise.all((data ?? []).map(mapFactWithSources));
    },
  };
}
