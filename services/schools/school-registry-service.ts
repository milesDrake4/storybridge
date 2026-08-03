import { z } from "zod";

import { schoolIdSchema } from "@/contracts/domain/ids";
import type { Page } from "@/contracts/http/v1/common";
import type {
  SchoolRequest,
  SchoolRequestInput,
  SchoolSearchQuery,
  SchoolSummary,
} from "@/contracts/http/v1/schools";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import { signCursor, verifyCursor } from "@/lib/http/signed-cursor";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac, createIdempotencyHmac } from "@/lib/security/hmac";
import { normalizePlainText } from "@/lib/security/request-boundary";
import type { SchoolRegistryRepository } from "@/repositories/school-registry-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

const cursorSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  id: schoolIdSchema,
  normalizedName: z.string().min(1).max(200),
  query: z.string().max(100),
  scope: z.literal("schools"),
  version: z.literal(1),
});

export class SchoolRegistryError extends Error {
  readonly code: Extract<ErrorCode, "IDEMPOTENCY_KEY_REUSED" | "INVALID_QUERY">;

  constructor(code: SchoolRegistryError["code"]) {
    super(code);
    this.name = "SchoolRegistryError";
    this.code = code;
  }
}

type SearchDependencies = EligibilityDependencies & {
  cursorSecret: string;
  schools: SchoolRegistryRepository;
};

export async function searchSchools(
  input: SchoolSearchQuery,
  dependencies: SearchDependencies,
  now = new Date(),
): Promise<Page<SchoolSummary>> {
  await requireProductEligibility(dependencies, now);
  const query = normalizePlainText(input.query).toLocaleLowerCase("en-US");
  const after = input.cursor
    ? verifyCursor(input.cursor, cursorSchema, dependencies.cursorSecret)
    : null;
  if (
    input.cursor &&
    (!after || after.query !== query || after.expiresAt <= now.getTime())
  ) {
    throw new SchoolRegistryError("INVALID_QUERY");
  }
  const rows = await dependencies.schools.search({
    after: after
      ? { id: after.id, normalizedName: after.normalizedName }
      : null,
    limit: input.limit + 1,
    query,
  });
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > input.limit && last
      ? signCursor(
          {
            expiresAt: now.getTime() + 15 * 60_000,
            id: last.id,
            normalizedName: last.canonicalName
              .normalize("NFKC")
              .toLocaleLowerCase("en-US"),
            query,
            scope: "schools",
            version: 1,
          },
          dependencies.cursorSecret,
        )
      : null;
  return { items, nextCursor };
}

type RequestDependencies = EligibilityDependencies & {
  hmacSecrets: HmacSecrets;
  schools: SchoolRegistryRepository;
};

export async function createSchoolRequest(
  input: SchoolRequestInput,
  request: { idempotencyKey: string },
  dependencies: RequestDependencies,
  now = new Date(),
): Promise<SchoolRequest> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const normalized = {
    name: normalizePlainText(input.name).trim(),
    url: input.url ?? null,
  };
  const result = await dependencies.schools.createRequest({
    idempotencyKeyHmac: createIdempotencyHmac(
      `${userId}:POST:/api/v1/school-requests:${request.idempotencyKey}`,
      dependencies.hmacSecrets,
    ),
    name: normalized.name,
    now,
    requestHmac: createContentHmac(
      JSON.stringify(normalized),
      dependencies.hmacSecrets,
    ),
    url: normalized.url,
    userId,
  });
  if (result.type === "IDEMPOTENCY_KEY_REUSED") {
    throw new SchoolRegistryError("IDEMPOTENCY_KEY_REUSED");
  }
  return result.value;
}
