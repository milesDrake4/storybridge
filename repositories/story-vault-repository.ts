import type {
  InterviewSessionId,
  StoryProfileId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  StoryFactCategory,
  StoryProfile,
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
  getInterview(
    userId: UserId,
    sessionId: InterviewSessionId,
  ): Promise<InterviewSessionWithMessages | null>;
}
