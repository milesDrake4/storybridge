import { z } from "zod";

export const canonicalUuidSchema = z
  .uuid()
  .refine(
    (value) => value === value.toLowerCase(),
    "UUID must use canonical lowercase form",
  );

export const userIdSchema = canonicalUuidSchema.brand<"UserId">();
export type UserId = z.infer<typeof userIdSchema>;

export const essayIdSchema = canonicalUuidSchema.brand<"EssayId">();
export type EssayId = z.infer<typeof essayIdSchema>;

export const essayVersionIdSchema =
  canonicalUuidSchema.brand<"EssayVersionId">();
export type EssayVersionId = z.infer<typeof essayVersionIdSchema>;

export const essayAngleIdSchema = canonicalUuidSchema.brand<"EssayAngleId">();
export type EssayAngleId = z.infer<typeof essayAngleIdSchema>;

export const schoolDossierIdSchema =
  canonicalUuidSchema.brand<"SchoolDossierId">();
export type SchoolDossierId = z.infer<typeof schoolDossierIdSchema>;

export const schoolDossierSourceIdSchema =
  canonicalUuidSchema.brand<"SchoolDossierSourceId">();
export type SchoolDossierSourceId = z.infer<typeof schoolDossierSourceIdSchema>;

export const aiOperationIdSchema = canonicalUuidSchema.brand<"AiOperationId">();
export type AiOperationId = z.infer<typeof aiOperationIdSchema>;

export const aiProposalIdSchema = canonicalUuidSchema.brand<"AiProposalId">();
export type AiProposalId = z.infer<typeof aiProposalIdSchema>;

export const proposalClaimIdSchema =
  canonicalUuidSchema.brand<"ProposalClaimId">();
export type ProposalClaimId = z.infer<typeof proposalClaimIdSchema>;

export const outlineSectionIdSchema =
  canonicalUuidSchema.brand<"OutlineSectionId">();
export type OutlineSectionId = z.infer<typeof outlineSectionIdSchema>;

export const interviewSessionIdSchema =
  canonicalUuidSchema.brand<"InterviewSessionId">();
export type InterviewSessionId = z.infer<typeof interviewSessionIdSchema>;

export const interviewMessageIdSchema =
  canonicalUuidSchema.brand<"InterviewMessageId">();
export type InterviewMessageId = z.infer<typeof interviewMessageIdSchema>;

export const storyProfileIdSchema =
  canonicalUuidSchema.brand<"StoryProfileId">();
export type StoryProfileId = z.infer<typeof storyProfileIdSchema>;

export const storyFactIdSchema = canonicalUuidSchema.brand<"StoryFactId">();
export type StoryFactId = z.infer<typeof storyFactIdSchema>;

export const schoolIdSchema = canonicalUuidSchema.brand<"SchoolId">();
export type SchoolId = z.infer<typeof schoolIdSchema>;

export const schoolRequestIdSchema =
  canonicalUuidSchema.brand<"SchoolRequestId">();
export type SchoolRequestId = z.infer<typeof schoolRequestIdSchema>;
