import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import { emptyRequestSchema } from "@/contracts/http/v1/envelopes";
import type { OutlineProposal } from "@/contracts/http/v1/outlines";
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
import { OutlineProposalError } from "@/services/strategy/propose-outline";

function parseEssayId(value: string): EssayId {
  const parsed = essayIdSchema.safeParse(value);
  if (!parsed.success) throw new OutlineProposalError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

export function createOutlineProposalPostHandler(dependencies: {
  appUrl: URL;
  propose(
    essayId: EssayId,
    request: { idempotencyKey: string; ipAddress: string },
  ): Promise<OutlineProposal>;
}) {
  return async function postOutlineProposal(
    request: Request,
    rawEssayId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      await readJsonBody(request, emptyRequestSchema);
      const proposal = await dependencies.propose(parseEssayId(rawEssayId), {
        idempotencyKey,
        ipAddress: clientIpAddress(request),
      });
      return createSuccessResponse(proposal, { status: 201 });
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof OutlineProposalError ||
        error instanceof AiOperationError
      ) {
        return createErrorResponse(error.code, {
          ...(error instanceof AiOperationError && error.resetAt
            ? { resetAt: error.resetAt.toISOString() }
            : {}),
        });
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
