import { z } from "zod";

import {
  aiProposalIdSchema,
  essayAngleIdSchema,
  essayIdSchema,
  outlineSectionIdSchema,
  schoolDossierSourceIdSchema,
  storyFactIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const outlineSectionSchema = z.strictObject({
  id: outlineSectionIdSchema,
  purpose: z.string().trim().min(1).max(300),
  schoolSourceIds: z
    .array(schoolDossierSourceIdSchema)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
  storyFactIds: z
    .array(storyFactIdSchema)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
  targetWords: z.number().int().min(1).max(1_000),
});

export const outlineV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    sections: z.array(outlineSectionSchema).min(3).max(6),
  })
  .refine(
    ({ sections }) =>
      new Set(sections.map((section) => section.id)).size === sections.length,
    "Outline section IDs must be unique",
  );
export type OutlineV1 = z.infer<typeof outlineV1Schema>;

export const outlineProposalDraftSchema = z.strictObject({
  outline: outlineV1Schema,
  rationale: z.string().trim().min(1).max(1_000),
});
export type OutlineProposalDraft = z.infer<typeof outlineProposalDraftSchema>;

export const outlineProposalSchema = outlineProposalDraftSchema.extend({
  canAccept: z.literal(false),
  createdAt: rfc3339UtcSchema,
  essayId: essayIdSchema,
  expiresAt: rfc3339UtcSchema,
  id: aiProposalIdSchema,
  kind: z.literal("OUTLINE"),
  selectedAngleId: essayAngleIdSchema,
  status: z.enum(["PENDING", "EXPIRED"]),
  targetRevision: z.number().int().nonnegative(),
  userId: userIdSchema,
});
export type OutlineProposal = z.infer<typeof outlineProposalSchema>;
