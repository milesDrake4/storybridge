import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import {
  continuationInputSchema,
  rewriteInputSchema,
  type ContinuationInput,
  type ContinuationProposal,
  type RewriteInput,
  type RewriteProposal,
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
import { RevisionProposalError } from "@/services/coaching/revision-shared";

type Metadata = { idempotencyKey: string; ipAddress: string };

function createPostHandler<Input, Output>(dependencies: {
  appUrl: URL;
  parseBody(request: Request): Promise<Input>;
  propose(essayId: EssayId, input: Input, metadata: Metadata): Promise<Output>;
}) {
  return async function post(request: Request, rawEssayId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      if (!essayId.success)
        throw new RevisionProposalError("RESOURCE_NOT_FOUND");
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await dependencies.parseBody(request);
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
        error instanceof RevisionProposalError ||
        error instanceof AiOperationError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}

export function createRewriteProposalPostHandler(dependencies: {
  appUrl: URL;
  propose(
    essayId: EssayId,
    input: RewriteInput,
    metadata: Metadata,
  ): Promise<RewriteProposal>;
}) {
  return createPostHandler({
    ...dependencies,
    parseBody: (request) => readJsonBody(request, rewriteInputSchema),
  });
}

export function createContinuationProposalPostHandler(dependencies: {
  appUrl: URL;
  propose(
    essayId: EssayId,
    input: ContinuationInput,
    metadata: Metadata,
  ): Promise<ContinuationProposal>;
}) {
  return createPostHandler({
    ...dependencies,
    parseBody: (request) => readJsonBody(request, continuationInputSchema),
  });
}
