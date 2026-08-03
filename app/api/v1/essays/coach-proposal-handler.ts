import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import {
  coachInputSchema,
  type AdviceProposal,
  type CoachInput,
} from "@/contracts/http/v1/proposals";
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
import { AdviceProposalError } from "@/services/coaching/propose-advice";

export function createCoachProposalPostHandler(dependencies: {
  appUrl: URL;
  propose(
    essayId: EssayId,
    input: CoachInput,
    request: { idempotencyKey: string; ipAddress: string },
  ): Promise<AdviceProposal>;
}) {
  return async function post(request: Request, rawEssayId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      if (!essayId.success) throw new AdviceProposalError("RESOURCE_NOT_FOUND");
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, coachInputSchema);
      return createSuccessResponse(
        await dependencies.propose(essayId.data, input, {
          idempotencyKey,
          ipAddress: clientIpAddress(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof AdviceProposalError ||
        error instanceof AiOperationError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
