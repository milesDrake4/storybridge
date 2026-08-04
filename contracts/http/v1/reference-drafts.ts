import { z } from "zod";

import {
  aiProposalIdSchema,
  essayIdSchema,
  proposalClaimIdSchema,
  schoolDossierSourceIdSchema,
  storyFactIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION =
  "reference-draft-2026-08-02" as const;

export const referenceDraftInputSchema = z.strictObject({
  acknowledgmentVersion: z.literal(CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION),
});
export type ReferenceDraftInput = z.infer<typeof referenceDraftInputSchema>;

export const referenceClaimDraftSchema = z
  .strictObject({
    end: z.number().int().positive().max(20_000),
    schoolSourceIds: z
      .array(schoolDossierSourceIdSchema)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length),
    start: z.number().int().nonnegative().max(19_999),
    storyFactIds: z
      .array(storyFactIdSchema)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length),
    text: z.string().trim().min(1).max(1_000),
  })
  .superRefine((claim, context) => {
    if (claim.end <= claim.start) {
      context.addIssue({
        code: "custom",
        message: "Claim end must be greater than start",
        path: ["end"],
      });
    }
    if (claim.storyFactIds.length + claim.schoolSourceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Reference claims require evidence",
        path: ["storyFactIds"],
      });
    }
  });
export type ReferenceClaimDraft = z.infer<typeof referenceClaimDraftSchema>;

export const referenceDraftDraftSchema = z.strictObject({
  claims: z.array(referenceClaimDraftSchema).min(1).max(50),
  rationale: z.string().trim().min(1).max(1_000),
  referenceText: z.string().trim().min(1).max(20_000),
});
export type ReferenceDraftDraft = z.infer<typeof referenceDraftDraftSchema>;

export const referenceClaimSchema = referenceClaimDraftSchema.safeExtend({
  contentHmac: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
  decision: z.enum(["CONFIRMED", "REJECTED"]).nullable().default(null),
  decidedAt: rfc3339UtcSchema.nullable().default(null),
  evidence: z.strictObject({
    schoolSources: z
      .array(
        z.strictObject({
          claim: z.string().trim().min(1).max(500),
          id: schoolDossierSourceIdSchema,
          title: z.string().trim().min(1).max(300),
        }),
      )
      .max(10),
    storyFacts: z
      .array(
        z.strictObject({
          id: storyFactIdSchema,
          summary: z.string().trim().min(1).max(500),
        }),
      )
      .max(10),
  }),
  id: proposalClaimIdSchema,
  status: z.literal("SUPPORTED"),
});
export type ReferenceClaim = z.infer<typeof referenceClaimSchema>;

export const referenceDraftProposalSchema = z.strictObject({
  acknowledgmentVersion: z.literal(CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION),
  canAccept: z.literal(false),
  claims: z.array(referenceClaimSchema).min(1).max(50),
  createdAt: rfc3339UtcSchema,
  essayId: essayIdSchema,
  expiresAt: rfc3339UtcSchema,
  id: aiProposalIdSchema,
  kind: z.literal("REFERENCE_DRAFT"),
  rationale: z.string().trim().min(1).max(1_000),
  referenceText: z.string().trim().min(1).max(20_000),
  status: z.enum(["PENDING", "EXPIRED"]),
  targetRevision: z.number().int().nonnegative(),
  userId: userIdSchema,
});
export type ReferenceDraftProposal = z.infer<
  typeof referenceDraftProposalSchema
>;

export const claimDecisionInputSchema = z.strictObject({
  decision: z.enum(["CONFIRM", "REJECT"]),
});
export type ClaimDecisionInput = z.infer<typeof claimDecisionInputSchema>;

export const claimConfirmationSchema = z.strictObject({
  claimContentHmac: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
  claimId: proposalClaimIdSchema,
  decidedAt: rfc3339UtcSchema,
  decision: z.enum(["CONFIRMED", "REJECTED"]),
  essayId: essayIdSchema,
  userId: userIdSchema,
});
export type ClaimConfirmation = z.infer<typeof claimConfirmationSchema>;
