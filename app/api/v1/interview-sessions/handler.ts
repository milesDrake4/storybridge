import { z } from "zod";

import { AiAdapterError } from "@/adapters/openai/client";
import { interviewSessionIdSchema } from "@/contracts/domain/ids";
import type {
  InterviewAnswerInput,
  InterviewSession,
  InterviewSessionWithMessages,
  InterviewTurn,
} from "@/contracts/http/v1/interviews";
import { interviewAnswerInputSchema } from "@/contracts/http/v1/interviews";
import { createErrorResponse, createSuccessResponse } from "@/lib/http/respond";
import {
  assertSameOriginMutation,
  clientIpAddress,
  readJsonBody,
  requireIdempotencyKey,
  RequestBoundaryError,
} from "@/lib/security/request-boundary";
import { EligibilityError } from "@/services/auth/eligibility";
import { AiOperationError } from "@/services/ai/reserve-operation";
import { InterviewError } from "@/services/interview/interview-service";
import type { InterviewAnswerRequest } from "@/services/interview/interview-service";

const emptyObjectSchema = z.strictObject({});

type StartDependencies = {
  appUrl: URL;
  start(): Promise<InterviewSession>;
};

type CurrentDependencies = {
  current(): Promise<InterviewSessionWithMessages>;
};

type AnswerDependencies = {
  answer(
    sessionId: ReturnType<typeof interviewSessionIdSchema.parse>,
    input: InterviewAnswerInput,
    request: InterviewAnswerRequest,
  ): Promise<InterviewTurn>;
  appUrl: URL;
};

function safeError(error: unknown): Response {
  if (error instanceof RequestBoundaryError) {
    return createErrorResponse(error.code);
  }
  if (error instanceof EligibilityError) {
    return createErrorResponse(error.code);
  }
  if (error instanceof InterviewError) {
    return createErrorResponse(error.code, {
      ...(error.safetyKind
        ? {
            fieldErrors: [{ code: error.safetyKind, path: "answer" }],
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
        : "SERVICE_UNAVAILABLE",
    );
  }
  return createErrorResponse("INTERNAL_ERROR");
}

export function createInterviewStartPostHandler(
  dependencies: StartDependencies,
) {
  return async function postInterviewStart(
    request: Request,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      requireIdempotencyKey(request);
      await readJsonBody(request, emptyObjectSchema);
      return createSuccessResponse(await dependencies.start(), { status: 201 });
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createCurrentInterviewGetHandler(
  dependencies: CurrentDependencies,
) {
  return async function getCurrentInterview(): Promise<Response> {
    try {
      return createSuccessResponse(await dependencies.current());
    } catch (error) {
      return safeError(error);
    }
  };
}

export function createInterviewAnswerPostHandler(
  dependencies: AnswerDependencies,
) {
  return async function postInterviewAnswer(
    request: Request,
    rawSessionId: string,
  ): Promise<Response> {
    try {
      assertSameOriginMutation(request, dependencies.appUrl);
      const idempotencyKey = requireIdempotencyKey(request);
      const sessionId = interviewSessionIdSchema.safeParse(rawSessionId);
      if (!sessionId.success) {
        return createErrorResponse("RESOURCE_NOT_FOUND");
      }
      const input = await readJsonBody(request, interviewAnswerInputSchema);
      return createSuccessResponse(
        await dependencies.answer(sessionId.data, input, {
          idempotencyKey,
          ipAddress: clientIpAddress(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}
