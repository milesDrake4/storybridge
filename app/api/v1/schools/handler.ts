import type { z } from "zod";

import type { Page } from "@/contracts/http/v1/common";
import {
  schoolRequestInputSchema,
  schoolSearchQuerySchema,
  type SchoolRequest,
  type SchoolRequestInput,
  type SchoolSummary,
} from "@/contracts/http/v1/schools";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { SchoolRegistryError } from "@/services/schools/school-registry-service";

function safeError(error: unknown): Response {
  if (
    error instanceof RequestBoundaryError ||
    error instanceof EligibilityError ||
    error instanceof SchoolRegistryError
  ) {
    return createErrorResponse(error.code);
  }
  return createErrorResponse("INTERNAL_ERROR");
}

function parseQuery(url: URL): z.output<typeof schoolSearchQuerySchema> {
  const allowed = new Set(["cursor", "limit", "query"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new SchoolRegistryError("INVALID_QUERY");
    }
  }
  const parsed = schoolSearchQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) throw new SchoolRegistryError("INVALID_QUERY");
  return parsed.data;
}

export function createSchoolsGetHandler(dependencies: {
  search(
    input: z.output<typeof schoolSearchQuerySchema>,
  ): Promise<Page<SchoolSummary>>;
}) {
  return async function getSchools(request: Request): Promise<Response> {
    try {
      return createSuccessResponse(
        await dependencies.search(parseQuery(new URL(request.url))),
      );
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createSchoolRequestPostHandler(dependencies: {
  appUrl: URL;
  create(
    input: SchoolRequestInput,
    request: { idempotencyKey: string },
  ): Promise<SchoolRequest>;
}) {
  return async function postSchoolRequest(request: Request): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, schoolRequestInputSchema);
      return createSuccessResponse(
        await dependencies.create(input, { idempotencyKey }),
        { status: 202 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}
