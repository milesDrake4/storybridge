import type {
  InterviewSessionId,
  StoryFactId,
  StoryProfileId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  StoryFact,
  StoryFactPatch,
  StoryFactCategory,
  StoryProfile,
  StoryProfilePatch,
  StoryProfileWithFacts,
  VoiceProfile,
} from "@/contracts/domain/story-vault";
import type { InterviewSessionWithMessages } from "@/contracts/http/v1/interviews";
import type { ContentHmac } from "@/lib/security/hmac";

export type PersistedStoryFactInput = {
  category: StoryFactCategory;
  contentHmac: ContentHmac;
  details: string[];
  sourceMessageIds: string[];
  summary: string;
};

export type CreateStoryProfileDecision =
  | { profile: StoryProfile; type: "CREATED" | "REPLAY" }
  | { type: "INCOMPLETE" | "INSUFFICIENT_COVERAGE" | "NOT_FOUND" };

export type StoryMutationDecision<Value> =
  | { type: "NOT_FOUND" | "REVISION_MISMATCH" }
  | { type: "REPLAY" | "UPDATED"; value: Value };

export interface StoryVaultRepository {
  create(input: {
    facts: PersistedStoryFactInput[];
    now: Date;
    sessionId: InterviewSessionId;
    userId: UserId;
    voiceProfile: VoiceProfile;
  }): Promise<CreateStoryProfileDecision>;
  findById(
    userId: UserId,
    profileId: StoryProfileId,
  ): Promise<StoryProfile | null>;
  findBySession(
    userId: UserId,
    sessionId: InterviewSessionId,
  ): Promise<StoryProfile | null>;
  getCurrent(userId: UserId): Promise<StoryProfileWithFacts | null>;
  getInterview(
    userId: UserId,
    sessionId: InterviewSessionId,
  ): Promise<InterviewSessionWithMessages | null>;
  updateProfile(input: {
    expectedRevision: number;
    now: Date;
    patch: StoryProfilePatch;
    profileId: StoryProfileId;
    userId: UserId;
  }): Promise<StoryMutationDecision<StoryProfile>>;
  updateFact(input: {
    contentHmac: ContentHmac;
    expectedRevision: number;
    factId: StoryFactId;
    now: Date;
    patch: StoryFactPatch;
    userId: UserId;
  }): Promise<StoryMutationDecision<StoryFact>>;
  verifyFact(input: {
    contentHmac: string;
    decision: "VERIFY" | "REJECT";
    expectedRevision: number;
    factId: StoryFactId;
    now: Date;
    userId: UserId;
  }): Promise<StoryMutationDecision<StoryFact>>;
  suppressFact(input: {
    factId: StoryFactId;
    now: Date;
    suppressed: boolean;
    userId: UserId;
  }): Promise<StoryMutationDecision<StoryFact>>;
  deleteFact(userId: UserId, factId: StoryFactId): Promise<boolean>;
  getFactsForAi(userId: UserId): Promise<StoryFact[]>;
}
