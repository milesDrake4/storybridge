import { z } from "zod";

import { AiAdapterError } from "@/adapters/openai/client";
import { interviewSessionIdSchema } from "@/contracts/domain/ids";
import type { StoryProfile } from "@/contracts/domain/story-vault";
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
import {
  StoryExtractionError,
  type StoryExtractionRequest,
} from "@/services/story-vault/extract-profile";

const emptyObjectSchema = z.strictObject({});

type Dependencies = {
  appUrl: URL;
  complete(
    sessionId: ReturnType<typeof interviewSessionIdSchema.parse>,
    request: StoryExtractionRequest,
  ): Promise<StoryProfile>;
};

export function createInterviewCompletePostHandler(dependencies: Dependencies) {
  return async function postInterviewComplete(
    request: Request,
    rawSessionId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const sessionId = interviewSessionIdSchema.safeParse(rawSessionId);
      if (!sessionId.success) return createErrorResponse("RESOURCE_NOT_FOUND");
      await readJsonBody(request, emptyObjectSchema);
      const profile = await dependencies.complete(sessionId.data, {
        idempotencyKey,
        ipAddress: clientIpAddress(request),
      });
      return createSuccessResponse(profile, { status: 201 });
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        return createErrorResponse(error.code);
      }
      if (error instanceof EligibilityError) {
        return createErrorResponse(error.code);
      }
      if (error instanceof StoryExtractionError) {
        return createErrorResponse(error.code, {
          ...(error.targetQuestionKey
            ? {
                fieldErrors: [
                  {
                    code: `MISSING_${error.targetQuestionKey}`,
                    path: "interview",
                  },
                ],
              }
            : {}),
        });
      }
      if (error instanceof AiOperationError) {
        return createErrorResponse(error.code, {
          ...(error.resetAt ? { resetAt: error.resetAt.toISOString() } : {}),
        });
      }
      if (error instanceof AiAdapterError) {
        return createErrorResponse(
          error.code === "PROVIDER_REFUSED"
            ? "PROVIDER_REFUSED"
            : error.code === "PROVIDER_INVALID_RESPONSE"
              ? "PROVIDER_INVALID_RESPONSE"
              : "SERVICE_UNAVAILABLE",
        );
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
