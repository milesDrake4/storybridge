import { z } from "zod";

import { requestIdSchema, rfc3339UtcSchema } from "@/contracts/http/v1/common";
import { errorCodeSchema } from "@/contracts/http/v1/errors";

export const API_VERSION = "1" as const;

export const emptyRequestSchema = z.strictObject({});

const responseMetaSchema = z.object({
  requestId: requestIdSchema,
});

export function apiSuccessSchema<DataSchema extends z.ZodType>(
  dataSchema: DataSchema,
) {
  return z.object({
    apiVersion: z.literal(API_VERSION),
    data: dataSchema,
    meta: responseMetaSchema,
  });
}

export type ApiSuccess<T> = {
  apiVersion: typeof API_VERSION;
  data: T;
  meta: { requestId: string };
};

export const fieldErrorSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const apiErrorSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    fieldErrors: z.array(fieldErrorSchema).optional(),
    followUpQuestion: z.string().min(1).max(300).optional(),
    resetAt: rfc3339UtcSchema.optional(),
  }),
  meta: responseMetaSchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;
