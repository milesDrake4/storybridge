import { z } from "zod";

import { aiPurposes } from "@/contracts/domain/ai-ports";

const countSchema = z.number().int().min(0).max(100_000);
const durationSchema = z.number().int().min(0).max(86_400_000);
const amountSchema = z.number().int().min(0).max(1_000_000);

function event<Name extends string, Shape extends z.ZodRawShape>(
  name: Name,
  properties: Shape,
) {
  return z.strictObject({
    name: z.literal(name),
    properties: z.strictObject(properties),
  });
}

export const productAnalyticsEventSchema = z.discriminatedUnion("name", [
  event("account_created", {}),
  event("interview_started", {}),
  event("interview_completed", {
    durationMs: durationSchema,
    questionCount: countSchema.max(20),
  }),
  event("story_vault_reviewed", { factCount: countSchema }),
  event("essay_created", { wordLimit: countSchema.max(1_000) }),
  event("research_completed", {
    durationMs: durationSchema,
    sourceCount: countSchema,
    status: z.enum(["SUCCEEDED", "FAILED"]),
  }),
  event("angle_selected", { position: z.number().int().min(1).max(3) }),
  event("outline_completed", { sectionCount: countSchema.max(10) }),
  event("first_draft_text_entered", { wordCount: countSchema }),
  event("rewrite_accepted", { selectionCharacters: countSchema }),
  event("fallback_used", { claimCount: countSchema.max(50) }),
  event("essay_completed", { wordCount: countSchema }),
  event("checkout_started", { amountCents: amountSchema }),
  event("purchase_completed", { amountCents: amountSchema }),
  event("account_deleted", {
    durationMs: durationSchema,
    status: z.enum(["COMPLETE", "FAILED"]),
  }),
]);
export type ProductAnalyticsEvent = z.infer<typeof productAnalyticsEventSchema>;

export const aiProviderMetricSchema = z.strictObject({
  finalCostCents: z.number().int().min(0).max(1_000_000),
  inputTokens: z.number().int().min(0).max(1_000_000).nullable(),
  latencyMs: durationSchema,
  modelId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)
    .nullable(),
  outputTokens: z.number().int().min(0).max(1_000_000).nullable(),
  purpose: z.enum(aiPurposes),
  status: z.enum(["SUCCEEDED", "FAILED", "REFUSED", "UNKNOWN"]),
});
export type AiProviderMetric = z.infer<typeof aiProviderMetricSchema>;
