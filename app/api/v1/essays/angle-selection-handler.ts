import {
  essayAngleIdSchema,
  essayIdSchema,
  type EssayAngleId,
  type EssayId,
} from "@/contracts/domain/ids";
import { emptyRequestSchema } from "@/contracts/http/v1/envelopes";
import type { Essay } from "@/contracts/http/v1/essays";
import { revisionEtag } from "@/lib/http/revision-etag";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { EssayAngleError } from "@/services/strategy/generate-angles";

function parseId<Id>(
  schema: { safeParse(value: string): { success: boolean; data?: Id } },
  value: string,
): Id {
  const parsed = schema.safeParse(value);
  if (!parsed.success || !parsed.data) {
    throw new EssayAngleError("RESOURCE_NOT_FOUND");
  }
  return parsed.data;
}

export function createAngleSelectionPostHandler(dependencies: {
  appUrl: URL;
  select(essayId: EssayId, angleId: EssayAngleId): Promise<Essay>;
}) {
  return async function postSelection(
    request: Request,
    rawEssayId: string,
    rawAngleId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      await readJsonBody(request, emptyRequestSchema);
      const essay = await dependencies.select(
        parseId(essayIdSchema, rawEssayId),
        parseId(essayAngleIdSchema, rawAngleId),
      );
      return createSuccessResponse(essay, {
        headers: {
          etag: revisionEtag({ id: essay.id, kind: "essay" }, essay.revision),
        },
      });
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof EssayAngleError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
