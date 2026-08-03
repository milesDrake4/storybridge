import { z } from "zod";

import {
  essayAngleIdSchema,
  essayIdSchema,
  schoolIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import {
  opaqueCursorSchema,
  pageSchema,
  rfc3339UtcSchema,
} from "@/contracts/http/v1/common";
import { schoolSummarySchema } from "@/contracts/http/v1/schools";

export const applicationSeasonSchema = z.literal("2026-2027");
export type ApplicationSeason = z.infer<typeof applicationSeasonSchema>;

export const essayStatusSchema = z.enum([
  "STRATEGY",
  "OUTLINING",
  "DRAFTING",
  "REVIEWING",
  "COMPLETE",
]);
export type EssayStatus = z.infer<typeof essayStatusSchema>;

export const createEssayInputSchema = z.strictObject({
  prompt: z.string().min(25).max(2_000),
  schoolId: schoolIdSchema,
  wordLimit: z.number().int().min(25).max(1_000),
});
export type CreateEssayInput = z.infer<typeof createEssayInputSchema>;

export const essayListQuerySchema = z.strictObject({
  cursor: opaqueCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EssayListQuery = z.infer<typeof essayListQuerySchema>;

export const essaySchema = z.object({
  createdAt: rfc3339UtcSchema,
  dossierId: z.uuid().nullable(),
  id: essayIdSchema,
  prompt: z.string().min(25).max(2_000),
  revision: z.number().int().nonnegative(),
  schoolId: schoolIdSchema,
  selectedAngleId: essayAngleIdSchema.nullable(),
  season: applicationSeasonSchema,
  status: essayStatusSchema,
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
  wordLimit: z.number().int().min(25).max(1_000),
});
export type Essay = z.infer<typeof essaySchema>;

export const essaySummarySchema = essaySchema
  .pick({
    createdAt: true,
    id: true,
    status: true,
    updatedAt: true,
    wordLimit: true,
  })
  .extend({ school: schoolSummarySchema });
export type EssaySummary = z.infer<typeof essaySummarySchema>;

export const essayWorkspaceSchema = z.object({
  essay: essaySchema,
  school: schoolSummarySchema,
});
export type EssayWorkspace = z.infer<typeof essayWorkspaceSchema>;

export const essayPageSchema = pageSchema(essaySummarySchema);
