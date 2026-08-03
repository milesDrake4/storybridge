import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import {
  angleGenerationInputSchema,
  type EssayAngle,
} from "@/contracts/domain/essay-angle";
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
import { EssayAngleError } from "@/services/strategy/generate-angles";

function parseEssayId(value: string): EssayId {
  const parsed = essayIdSchema.safeParse(value);
  if (!parsed.success) throw new EssayAngleError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

export function createAnglesPostHandler(dependencies: {
  appUrl: URL;
  generate(
    essayId: EssayId,
    input: { regenerate: boolean },
    request: { idempotencyKey: string; ipAddress: string },
  ): Promise<[EssayAngle, EssayAngle, EssayAngle]>;
}) {
  return async function postAngles(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, angleGenerationInputSchema);
      const angles = await dependencies.generate(
        parseEssayId(rawEssayId),
        input,
        {
          idempotencyKey,
          ipAddress: clientIpAddress(request),
        },
      );
      return createSuccessResponse({ angles }, { status: 201 });
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof AiOperationError
      ) {
        return createErrorResponse(error.code, {
          ...(error instanceof AiOperationError && error.resetAt
            ? { resetAt: error.resetAt.toISOString() }
            : {}),
        });
      }
      if (error instanceof EssayAngleError) {
        return createErrorResponse(error.code, {
          ...(error.followUpQuestion
            ? { followUpQuestion: error.followUpQuestion }
            : {}),
        });
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
