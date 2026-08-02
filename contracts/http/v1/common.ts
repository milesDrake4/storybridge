import { z } from "zod";

import { canonicalUuidSchema } from "@/contracts/domain/ids";

const URL_SAFE_PATTERN = /^[A-Za-z0-9._~-]+$/;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const CANONICAL_UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const requestIdSchema = canonicalUuidSchema.brand<"RequestId">();
export type RequestId = z.infer<typeof requestIdSchema>;

export const rfc3339UtcSchema = z.iso
  .datetime({ offset: false })
  .refine((value) => value.endsWith("Z"), "Timestamp must use UTC");
export type Rfc3339Utc = z.infer<typeof rfc3339UtcSchema>;

export const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(OPAQUE_CURSOR_PATTERN, "Cursor must be opaque base64url text")
  .brand<"OpaqueCursor">();
export type OpaqueCursor = z.infer<typeof opaqueCursorSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(URL_SAFE_PATTERN, "Idempotency key must be URL-safe")
  .brand<"IdempotencyKey">();
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const revisionEtagSchema = z
  .string()
  .regex(
    new RegExp(
      `^"(?:essay|profile|fact):${CANONICAL_UUID_SOURCE}:r(?:0|[1-9][0-9]*)"$`,
    ),
    "Invalid revision ETag",
  )
  .brand<"RevisionEtag">();
export type RevisionEtag = z.infer<typeof revisionEtagSchema>;

export const paginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: opaqueCursorSchema.optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function pageSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: opaqueCursorSchema.nullable(),
  });
}

export type Page<T> = {
  items: T[];
  nextCursor: OpaqueCursor | null;
};
