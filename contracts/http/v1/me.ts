import { z } from "zod";

import { userIdSchema } from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

const policyVersionSchema = z.string().trim().min(1).max(100);

export const consentInputSchema = z.strictObject({
  ageConfirmed: z.literal(true),
  birthYear: z.number().int().min(1900).max(9_999),
  privacyVersion: policyVersionSchema,
  responsibleUseVersion: policyVersionSchema,
  termsVersion: policyVersionSchema,
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

export const profileSchema = z.object({
  ageConfirmedAt: rfc3339UtcSchema,
  birthYear: z.number().int().min(1900).max(9_999),
  consentedAt: rfc3339UtcSchema,
  createdAt: rfc3339UtcSchema,
  displayName: z.string().min(1).max(100).nullable(),
  onboardingState: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE"]),
  privacyVersion: policyVersionSchema,
  responsibleUseVersion: policyVersionSchema,
  termsVersion: policyVersionSchema,
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
});
export type Profile = z.infer<typeof profileSchema>;
