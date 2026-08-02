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

export const aiOperationIdSchema = canonicalUuidSchema.brand<"AiOperationId">();
export type AiOperationId = z.infer<typeof aiOperationIdSchema>;
