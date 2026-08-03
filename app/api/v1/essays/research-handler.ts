import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import {
  researchInputSchema,
  type SchoolDossier,
} from "@/contracts/domain/school-dossier";
import {
  requireRevision,
  revisionEtag,
  RevisionHeaderError,
} from "@/lib/http/revision-etag";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  clientIpAddress,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { AiOperationError } from "@/services/ai/reserve-operation";
import { EligibilityError } from "@/services/auth/eligibility";
import { SchoolDossierError } from "@/services/research/create-dossier";
import type { SchoolDossierResult } from "@/services/research/create-dossier";

function essayId(raw: string): EssayId {
  const parsed = essayIdSchema.safeParse(raw);
  if (!parsed.success) throw new SchoolDossierError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

function safeError(error: unknown): Response {
  if (
    error instanceof RequestBoundaryError ||
    error instanceof RevisionHeaderError ||
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
  ): Promise<SchoolDossierResult>;
  refresh(
    essayId: EssayId,
    expectedRevision: number,
    request: { idempotencyKey: string; ipAddress: string },
  ): Promise<SchoolDossierResult>;
}) {
  return async function postDossier(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, researchInputSchema);
      const id = essayId(rawEssayId);
      const metadata = {
        idempotencyKey,
        ipAddress: clientIpAddress(request),
      };
      const result = input.refresh
        ? await dependencies.refresh(
            id,
            requireRevision(request, { id, kind: "essay" }),
            metadata,
          )
        : await dependencies.create(id, metadata);
      return createSuccessResponse(result.dossier, {
        headers: {
          etag: revisionEtag(
            { id: result.dossier.essayId, kind: "essay" },
            result.essayRevision,
          ),
        },
        status: 201,
      });
    } catch (error) {
      return safeError(error);
    }
  };
}
