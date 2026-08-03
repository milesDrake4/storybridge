import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import {
  referenceDraftInputSchema,
  type ReferenceDraftInput,
  type ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";
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
import { ReferenceDraftError } from "@/services/fallback/generate-reference";

export function createReferenceDraftPostHandler(dependencies: {
  appUrl: URL;
  generate(
    essayId: EssayId,
    input: ReferenceDraftInput,
    metadata: { idempotencyKey: string; ipAddress: string },
  ): Promise<ReferenceDraftProposal>;
}) {
  return async function post(request: Request, rawEssayId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      if (!essayId.success) throw new ReferenceDraftError("RESOURCE_NOT_FOUND");
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, referenceDraftInputSchema);
      return createSuccessResponse(
        await dependencies.generate(essayId.data, input, {
          idempotencyKey,
          ipAddress: clientIpAddress(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof ReferenceDraftError ||
        error instanceof AiOperationError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
