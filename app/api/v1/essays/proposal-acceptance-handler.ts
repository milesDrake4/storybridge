import {
  aiProposalIdSchema,
  essayIdSchema,
  type AiProposalId,
  type EssayId,
} from "@/contracts/domain/ids";
import type { Essay } from "@/contracts/http/v1/essays";
import {
  acceptProposalInputSchema,
  type AcceptProposalInput,
} from "@/contracts/http/v1/proposals";
import {
  requireRevision,
  revisionEtag,
  RevisionHeaderError,
} from "@/lib/http/revision-etag";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { ProposalAcceptanceError } from "@/services/coaching/accept-proposal";

export function createProposalAcceptancePostHandler(dependencies: {
  accept(
    essayId: EssayId,
    proposalId: AiProposalId,
    input: AcceptProposalInput,
    metadata: { idempotencyKey: string },
  ): Promise<Essay>;
  appUrl: URL;
}) {
  return async function post(
    request: Request,
    rawEssayId: string,
    rawProposalId: string,
  ) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      const proposalId = aiProposalIdSchema.safeParse(rawProposalId);
      if (!essayId.success || !proposalId.success) {
        throw new ProposalAcceptanceError("RESOURCE_NOT_FOUND");
      }
      const headerRevision = requireRevision(request, {
        id: essayId.data,
        kind: "essay",
      });
      const idempotencyKey = requireIdempotencyKey(request);
      const input = await readJsonBody(request, acceptProposalInputSchema);
      if (input.expectedRevision !== headerRevision) {
        throw new RevisionHeaderError("REVISION_MISMATCH");
      }
      const essay = await dependencies.accept(
        essayId.data,
        proposalId.data,
        input,
        { idempotencyKey },
      );
      return createSuccessResponse(essay, {
        headers: {
          etag: revisionEtag({ id: essay.id, kind: "essay" }, essay.revision),
        },
      });
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof RevisionHeaderError ||
        error instanceof EligibilityError ||
        error instanceof ProposalAcceptanceError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
