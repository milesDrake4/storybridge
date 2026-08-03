import { z } from "zod";

import {
  aiProposalIdSchema,
  essayIdSchema,
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
