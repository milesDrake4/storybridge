import {
  essayIdSchema,
  proposalClaimIdSchema,
  type EssayId,
  type ProposalClaimId,
} from "@/contracts/domain/ids";
import {
  claimDecisionInputSchema,
  type ClaimConfirmation,
  type ClaimDecisionInput,
} from "@/contracts/http/v1/reference-drafts";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { ClaimDecisionError } from "@/services/fallback/decide-claim";

export function createClaimConfirmationPutHandler(dependencies: {
  appUrl: URL;
  decide(
    essayId: EssayId,
    claimId: ProposalClaimId,
    input: ClaimDecisionInput,
    request: { idempotencyKey: string },
  ): Promise<ClaimConfirmation>;
}) {
  return async function put(
    request: Request,
    rawEssayId: string,
    rawClaimId: string,
  ) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      const claimId = proposalClaimIdSchema.safeParse(rawClaimId);
      if (!essayId.success || !claimId.success) {
        throw new ClaimDecisionError("RESOURCE_NOT_FOUND");
      }
      const input = await readJsonBody(request, claimDecisionInputSchema);
      return createSuccessResponse(
        await dependencies.decide(essayId.data, claimId.data, input, {
          idempotencyKey: requireIdempotencyKey(request),
        }),
      );
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof ClaimDecisionError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
