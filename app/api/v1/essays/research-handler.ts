import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  clientIpAddress,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { AiOperationError } from "@/services/ai/reserve-operation";
import { EligibilityError } from "@/services/auth/eligibility";
import { SchoolDossierError } from "@/services/research/create-dossier";

function essayId(raw: string): EssayId {
  const parsed = essayIdSchema.safeParse(raw);
  if (!parsed.success) throw new SchoolDossierError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

function safeError(error: unknown): Response {
  if (
    error instanceof RequestBoundaryError ||
    error instanceof AiOperationError ||
    error instanceof EligibilityError ||
    error instanceof SchoolDossierError
  ) {
    return createErrorResponse(error.code, {
      ...(error instanceof AiOperationError && error.resetAt
        ? { resetAt: error.resetAt.toISOString() }
        : {}),
    });
  }
  return createErrorResponse("INTERNAL_ERROR");
}

export function createDossierGetHandler(dependencies: {
  get(essayId: EssayId): Promise<SchoolDossier>;
}) {
  return async function getDossier(rawEssayId: string): Promise<Response> {
    try {
      return createSuccessResponse(await dependencies.get(essayId(rawEssayId)));
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createDossierPostHandler(dependencies: {
  appUrl: URL;
  create(
    essayId: EssayId,
    request: { idempotencyKey: string; ipAddress: string },
  ): Promise<SchoolDossier>;
}) {
  return async function postDossier(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      return createSuccessResponse(
        await dependencies.create(essayId(rawEssayId), {
          idempotencyKey,
          ipAddress: clientIpAddress(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}
