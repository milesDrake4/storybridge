import { describe, expect, it } from "vitest";

import { essayIdSchema, userIdSchema } from "@/contracts/domain/ids";
import {
  idempotencyKeySchema,
  opaqueCursorSchema,
  pageSchema,
  paginationQuerySchema,
  revisionEtagSchema,
  rfc3339UtcSchema,
} from "@/contracts/http/v1/common";
import {
  apiErrorSchema,
  apiSuccessSchema,
  emptyRequestSchema,
} from "@/contracts/http/v1/envelopes";
import { errorCodeSchema, errorStatusByCode } from "@/contracts/http/v1/errors";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import { z } from "zod";

const requestId = "019c1f4f-3d2a-7d83-a32c-3c0c76f72ce2";

describe("HTTP v1 request and response schemas", () => {
  it("rejects unknown request fields but accepts additive response fields", () => {
    expect(emptyRequestSchema.safeParse({ unexpected: true }).success).toBe(
      false,
    );

    const parsed = apiSuccessSchema(
      z.object({ accepted: z.literal(true) }),
    ).parse({
      apiVersion: "1",
      data: { accepted: true, futureDataField: "ignored" },
      meta: { requestId, futureMetaField: "ignored" },
      futureEnvelopeField: "ignored",
    });

    expect(parsed).toEqual({
      apiVersion: "1",
      data: { accepted: true },
      meta: { requestId },
    });
  });

  it("keeps every stable error code paired with its declared HTTP status", () => {
    for (const code of errorCodeSchema.options) {
      expect(errorStatusByCode[code]).toBeTypeOf("number");
    }

    expect(errorStatusByCode.REVISION_MISMATCH).toBe(412);
    expect(errorStatusByCode.VALIDATION_ERROR).toBe(422);
    expect(errorStatusByCode.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe("HTTP v1 primitives", () => {
  it("accepts canonical UUIDs and rejects non-canonical resource IDs", () => {
    expect(userIdSchema.safeParse(requestId).success).toBe(true);
    expect(essayIdSchema.safeParse(requestId).success).toBe(true);
    expect(
      userIdSchema.safeParse("019C1F4F-3D2A-7D83-A32C-3C0C76F72CE2").success,
    ).toBe(false);
    expect(userIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("accepts only RFC 3339 UTC timestamps", () => {
    expect(rfc3339UtcSchema.safeParse("2026-08-02T18:30:00Z").success).toBe(
      true,
    );
    expect(
      rfc3339UtcSchema.safeParse("2026-08-02T14:30:00-04:00").success,
    ).toBe(false);
    expect(rfc3339UtcSchema.safeParse("2026-08-02 18:30:00Z").success).toBe(
      false,
    );
  });

  it("validates opaque cursors and idempotency keys as URL-safe values", () => {
    expect(opaqueCursorSchema.safeParse("c29ydD0yMDI2XzA4XzAy").success).toBe(
      true,
    );
    expect(opaqueCursorSchema.safeParse("cursor with spaces").success).toBe(
      false,
    );
    expect(idempotencyKeySchema.safeParse("essay-create_01.abc").success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse("too-short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("validates essay, profile, and fact revision ETags", () => {
    expect(
      revisionEtagSchema.safeParse(`"essay:${requestId}:r0"`).success,
    ).toBe(true);
    expect(
      revisionEtagSchema.safeParse(`"profile:${requestId}:r12"`).success,
    ).toBe(true);
    expect(revisionEtagSchema.safeParse(`"fact:${requestId}:r3"`).success).toBe(
      true,
    );
    expect(revisionEtagSchema.safeParse(`essay:${requestId}:r0`).success).toBe(
      false,
    );
    expect(
      revisionEtagSchema.safeParse(`"essay:${requestId}:r01"`).success,
    ).toBe(false);
  });

  it("applies bounded pagination defaults and evolvable page responses", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(paginationQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
    expect(paginationQuerySchema.safeParse({ limit: "51" }).success).toBe(
      false,
    );
    expect(
      paginationQuerySchema.safeParse({ limit: "20", extra: "no" }).success,
    ).toBe(false);

    expect(
      pageSchema(z.object({ id: userIdSchema })).parse({
        items: [{ id: requestId, futureField: true }],
        nextCursor: null,
        futurePageField: true,
      }),
    ).toEqual({ items: [{ id: requestId }], nextCursor: null });
  });
});

describe("HTTP v1 response helpers", () => {
  it("uses one request ID in the envelope and headers with no-store caching", async () => {
    const response = createSuccessResponse(
      { accepted: true as const },
      { requestId, status: 202 },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      apiSuccessSchema(z.object({ accepted: z.literal(true) })).parse(
        await response.json(),
      ),
    ).toEqual({
      apiVersion: "1",
      data: { accepted: true },
      meta: { requestId },
    });
  });

  it("returns only stable presentation errors without internal details", async () => {
    const response = createErrorResponse("PROVIDER_INVALID_RESPONSE", {
      requestId,
    });
    const body = apiErrorSchema.parse(await response.json());

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(body.error.code).toBe("PROVIDER_INVALID_RESPONSE");
    expect(body.error.retryable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("OpenAI");
    expect(JSON.stringify(body)).not.toContain("provider payload");
  });
});
