import { z } from "zod";

import {
  schoolIdSchema,
  schoolRequestIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import {
  opaqueCursorSchema,
  pageSchema,
  rfc3339UtcSchema,
} from "@/contracts/http/v1/common";

const httpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS is required");

export const schoolSummarySchema = z.object({
  canonicalName: z.string().min(1).max(200),
  id: schoolIdSchema,
  officialDomain: z.string().min(1).max(253),
});
export type SchoolSummary = z.infer<typeof schoolSummarySchema>;

export const schoolSearchQuerySchema = z.strictObject({
  cursor: opaqueCursorSchema.refine((value) => value.length >= 64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(100).default(""),
});
export type SchoolSearchQuery = z.infer<typeof schoolSearchQuerySchema>;
export const schoolPageSchema = pageSchema(schoolSummarySchema);

export const schoolRequestInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  url: httpsUrlSchema.optional(),
});
export type SchoolRequestInput = z.infer<typeof schoolRequestInputSchema>;

export const schoolRequestSchema = z.object({
  createdAt: rfc3339UtcSchema,
  id: schoolRequestIdSchema,
  name: z.string().min(1).max(200),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  updatedAt: rfc3339UtcSchema,
  url: httpsUrlSchema.nullable(),
  userId: userIdSchema,
});
export type SchoolRequest = z.infer<typeof schoolRequestSchema>;
