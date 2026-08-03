import { z } from "zod";

import {
  aiProposalIdSchema,
  essayIdSchema,
  schoolDossierSourceIdSchema,
  storyFactIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const coachInputSchema = z.strictObject({
  question: z.string().trim().min(1).max(2_000),
});
export type CoachInput = z.infer<typeof coachInputSchema>;

export const adviceDraftSchema = z.strictObject({
  guidance: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  headline: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(1_000),
});
export type AdviceDraft = z.infer<typeof adviceDraftSchema>;

export const adviceProposalSchema = adviceDraftSchema.extend({
  canAccept: z.literal(false),
  createdAt: rfc3339UtcSchema,
  essayId: essayIdSchema,
  expiresAt: rfc3339UtcSchema,
  id: aiProposalIdSchema,
  kind: z.literal("ADVICE"),
  status: z.enum(["PENDING", "EXPIRED"]),
  targetRevision: z.number().int().nonnegative(),
  userId: userIdSchema,
});
export type AdviceProposal = z.infer<typeof adviceProposalSchema>;

export const draftTextHashSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Expected a SHA-256 base64url digest");

export const rewriteInstructionSchema = z.enum([
  "CLARIFY",
  "TIGHTEN",
  "EXPAND",
  "STRENGTHEN_EVIDENCE",
  "IMPROVE_TRANSITION",
  "PRESERVE_VOICE",
  "CUSTOM",
]);
export type RewriteInstruction = z.infer<typeof rewriteInstructionSchema>;

export const rewriteInputSchema = z
  .strictObject({
    customInstruction: z.string().trim().min(1).max(500).optional(),
    instruction: rewriteInstructionSchema,
    selection: z.strictObject({
      end: z.number().int().positive().max(20_000),
      start: z.number().int().nonnegative().max(19_999),
      textHash: draftTextHashSchema,
    }),
  })
  .superRefine((value, context) => {
    if (value.selection.end <= value.selection.start) {
      context.addIssue({
        code: "custom",
        message: "Selection end must be greater than start",
        path: ["selection", "end"],
      });
    }
    if (
      (value.instruction === "CUSTOM") !==
      (value.customInstruction !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom text is allowed and required only for CUSTOM",
        path: ["customInstruction"],
      });
    }
  });
export type RewriteInput = z.infer<typeof rewriteInputSchema>;

export const continuationInputSchema = z.strictObject({
  contextHash: draftTextHashSchema,
  cursorOffset: z.number().int().nonnegative().max(20_000),
});
export type ContinuationInput = z.infer<typeof continuationInputSchema>;

export const generatedClaimSchema = z
  .strictObject({
    schoolSourceIds: z.array(schoolDossierSourceIdSchema).max(10),
    status: z.enum(["SUPPORTED", "BLOCKING_UNSUPPORTED"]),
    storyFactIds: z.array(storyFactIdSchema).max(10),
    text: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    const referenceCount =
      value.schoolSourceIds.length + value.storyFactIds.length;
    if (value.status === "SUPPORTED" && referenceCount === 0) {
      context.addIssue({
        code: "custom",
        message: "Supported claims require evidence",
        path: ["status"],
      });
    }
    if (value.status === "BLOCKING_UNSUPPORTED" && referenceCount !== 0) {
      context.addIssue({
        code: "custom",
        message: "Unsupported claims cannot cite evidence",
        path: ["status"],
      });
    }
  });
export type GeneratedClaim = z.infer<typeof generatedClaimSchema>;

export const rewriteDraftSchema = z.strictObject({
  claims: z.array(generatedClaimSchema).max(10),
  proposedText: z.string().trim().min(1).max(4_000),
  rationale: z.string().trim().min(1).max(1_000),
});
export type RewriteDraft = z.infer<typeof rewriteDraftSchema>;

export const rewriteProposalSchema = rewriteDraftSchema.extend({
  canAccept: z.literal(true),
  createdAt: rfc3339UtcSchema,
  essayId: essayIdSchema,
  expiresAt: rfc3339UtcSchema,
  id: aiProposalIdSchema,
  instruction: rewriteInstructionSchema,
  kind: z.literal("REWRITE"),
  selection: z.strictObject({
    end: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    textHash: draftTextHashSchema,
  }),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"]),
  targetRevision: z.number().int().nonnegative(),
  userId: userIdSchema,
});
export type RewriteProposal = z.infer<typeof rewriteProposalSchema>;

const continuationSuggestionSchema = z.strictObject({
  claims: z.array(generatedClaimSchema).max(10),
  proposedText: z.string().trim().min(1).max(1_000),
  rationale: z.string().trim().min(1).max(500),
});

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

export const continuationDraftSchema = z
  .strictObject({
    suggestions: z.array(continuationSuggestionSchema).min(1).max(3),
  })
  .superRefine((value, context) => {
    if (
      value.suggestions.reduce(
        (total, suggestion) => total + wordCount(suggestion.proposedText),
        0,
      ) > 100
    ) {
      context.addIssue({
        code: "custom",
        message: "Continuation suggestions may contain at most 100 words total",
        path: ["suggestions"],
      });
    }
  });
export type ContinuationDraft = z.infer<typeof continuationDraftSchema>;

export const continuationProposalSchema = continuationDraftSchema.safeExtend({
  canAccept: z.literal(true),
  contextHash: draftTextHashSchema,
  createdAt: rfc3339UtcSchema,
  cursorOffset: z.number().int().nonnegative(),
  essayId: essayIdSchema,
  expiresAt: rfc3339UtcSchema,
  id: aiProposalIdSchema,
  kind: z.literal("CONTINUATION"),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"]),
  targetRevision: z.number().int().nonnegative(),
  userId: userIdSchema,
});
export type ContinuationProposal = z.infer<typeof continuationProposalSchema>;
