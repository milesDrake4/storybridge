import { z } from "zod";

import {
  interviewMessageIdSchema,
  interviewSessionIdSchema,
  storyFactIdSchema,
  storyProfileIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const storyFactCategorySchema = z.enum([
  "ACADEMICS",
  "ACTIVITIES",
  "RESPONSIBILITIES",
  "EXPERIENCES",
  "VALUES",
  "GOALS",
  "VOICE",
]);
export type StoryFactCategory = z.infer<typeof storyFactCategorySchema>;

export const voiceProfileSchema = z.strictObject({
  sentenceStyle: z.string().min(1).max(300),
  toneTraits: z.array(z.string().min(1).max(80)).min(1).max(5),
  vocabulary: z.string().min(1).max(300),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const extractedStoryFactSchema = z.strictObject({
  category: storyFactCategorySchema,
  certainty: z.literal("EXPLICIT"),
  details: z.array(z.string().min(1).max(500)).min(1).max(10),
  sensitive: z.literal(false),
  sourceMessageIds: z.array(interviewMessageIdSchema).min(1).max(18),
  summary: z.string().min(1).max(500),
});
export type ExtractedStoryFact = z.infer<typeof extractedStoryFactSchema>;

export const storyExtractionSchema = z.strictObject({
  facts: z.array(extractedStoryFactSchema).min(1).max(30),
  voiceProfile: voiceProfileSchema,
});
export type StoryExtraction = z.infer<typeof storyExtractionSchema>;

export const storyProfileSchema = z.object({
  createdAt: rfc3339UtcSchema,
  excludedTopics: z.array(z.string().min(1).max(200)).max(20),
  id: storyProfileIdSchema,
  revision: z.number().int().positive(),
  sourceSessionId: interviewSessionIdSchema,
  status: z.enum(["REVIEW_REQUIRED", "ACTIVE"]),
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
  version: z.number().int().positive(),
  voiceProfile: voiceProfileSchema,
});
export type StoryProfile = z.infer<typeof storyProfileSchema>;

export const storyFactSchema = z.object({
  category: storyFactCategorySchema,
  contentHmac: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
  createdAt: rfc3339UtcSchema,
  details: z.array(z.string().min(1).max(500)).min(1).max(10),
  id: storyFactIdSchema,
  profileId: storyProfileIdSchema,
  revision: z.number().int().positive(),
  sourceMessageIds: z.array(interviewMessageIdSchema).min(1).max(18),
  summary: z.string().min(1).max(500),
  suppressedAt: rfc3339UtcSchema.nullable(),
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
  verificationStatus: z.enum(["UNVERIFIED", "VERIFIED", "REJECTED"]),
  verifiedAt: rfc3339UtcSchema.nullable(),
});
export type StoryFact = z.infer<typeof storyFactSchema>;

export const storyFactWithSourcesSchema = storyFactSchema.extend({
  sources: z.array(
    z.object({
      content: z.string().min(1).max(4000),
      id: interviewMessageIdSchema,
      questionKey: z.string().min(1).max(64),
    }),
  ),
});
export type StoryFactWithSources = z.infer<typeof storyFactWithSourcesSchema>;

export const storyProfileWithFactsSchema = z.object({
  facts: z.array(storyFactWithSourcesSchema),
  profile: storyProfileSchema,
});
export type StoryProfileWithFacts = z.infer<typeof storyProfileWithFactsSchema>;

export const storyProfilePatchSchema = z
  .strictObject({
    excludedTopics: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .optional(),
    voiceProfile: voiceProfileSchema.optional(),
  })
  .refine(
    (value) =>
      value.excludedTopics !== undefined || value.voiceProfile !== undefined,
    "At least one profile field is required",
  );
export type StoryProfilePatch = z.infer<typeof storyProfilePatchSchema>;

export const storyFactPatchSchema = z.strictObject({
  details: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  summary: z.string().trim().min(1).max(500),
});
export type StoryFactPatch = z.infer<typeof storyFactPatchSchema>;

export const storyFactVerificationInputSchema = z.strictObject({
  contentHash: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
  decision: z.enum(["VERIFY", "REJECT"]),
  expectedRevision: z.number().int().positive(),
});
export type StoryFactVerificationInput = z.infer<
  typeof storyFactVerificationInputSchema
>;

export const storyFactSuppressionInputSchema = z.strictObject({
  suppressed: z.boolean(),
});
