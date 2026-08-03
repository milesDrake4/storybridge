import {
  essayAnglePatchSchema,
  type EssayAngle,
  type EssayAnglePatch,
} from "@/contracts/domain/essay-angle";
import {
  essayAngleIdSchema,
  essayIdSchema,
  type EssayAngleId,
  type EssayId,
} from "@/contracts/domain/ids";
import {
  requireRevision,
  revisionEtag,
  RevisionHeaderError,
} from "@/lib/http/revision-etag";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { EssayAngleError } from "@/services/strategy/generate-angles";

function ids(rawEssayId: string, rawAngleId: string) {
  const essayId = essayIdSchema.safeParse(rawEssayId);
  const angleId = essayAngleIdSchema.safeParse(rawAngleId);
  if (!essayId.success || !angleId.success) {
    throw new EssayAngleError("RESOURCE_NOT_FOUND");
  }
  return { angleId: angleId.data, essayId: essayId.data };
}

export function createAnglePatchHandler(dependencies: {
  appUrl: URL;
  update(
    essayId: EssayId,
    angleId: EssayAngleId,
    revision: number,
    patch: EssayAnglePatch,
  ): Promise<{ angle: EssayAngle; essayRevision: number }>;
}) {
  return async function patchAngle(
    request: Request,
    rawEssayId: string,
    rawAngleId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const parsed = ids(rawEssayId, rawAngleId);
      const revision = requireRevision(request, {
        id: parsed.essayId,
        kind: "essay",
      });
      const patch = await readJsonBody(request, essayAnglePatchSchema);
      const result = await dependencies.update(
        parsed.essayId,
        parsed.angleId,
        revision,
        patch,
      );
      return createSuccessResponse(result.angle, {
        headers: {
          etag: revisionEtag(
            { id: parsed.essayId, kind: "essay" },
            result.essayRevision,
          ),
        },
      });
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof RevisionHeaderError ||
        error instanceof EligibilityError ||
        error instanceof EssayAngleError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
