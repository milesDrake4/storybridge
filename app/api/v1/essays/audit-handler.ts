import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import { auditInputSchema, type EssayAudit } from "@/contracts/http/v1/audits";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { AuditEssayError } from "@/services/audit/audit-essay";
import { EligibilityError } from "@/services/auth/eligibility";

export function createAuditPostHandler(dependencies: {
  appUrl: URL;
  audit(
    essayId: EssayId,
    metadata: { idempotencyKey: string },
  ): Promise<EssayAudit>;
}) {
  return async function post(request: Request, rawEssayId: string) {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const essayId = essayIdSchema.safeParse(rawEssayId);
      if (!essayId.success) throw new AuditEssayError("RESOURCE_NOT_FOUND");
      await readJsonBody(request, auditInputSchema);
      return createSuccessResponse(
        await dependencies.audit(essayId.data, {
          idempotencyKey: requireIdempotencyKey(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      if (
        error instanceof RequestBoundaryError ||
        error instanceof EligibilityError ||
        error instanceof AuditEssayError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
