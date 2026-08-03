import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { OpaqueCursor } from "@/contracts/http/v1/common";

const envelopeSchema = z.strictObject({
  payload: z.string().min(1),
  signature: z.string().length(43),
});

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url");
}

export function signCursor(value: unknown, secret: string): OpaqueCursor {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url",
  );
  return Buffer.from(
    JSON.stringify({ payload, signature: signature(payload, secret) }),
    "utf8",
  ).toString("base64url") as OpaqueCursor;
}

export function verifyCursor<Schema extends z.ZodType>(
  cursor: string,
  schema: Schema,
  secret: string,
): z.output<Schema> | null {
  try {
    const envelope = envelopeSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    const expected = Buffer.from(signature(envelope.payload, secret));
    const actual = Buffer.from(envelope.signature);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }
    return schema.parse(
      JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}
