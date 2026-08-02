import { isIP } from "node:net";

import { z } from "zod";

import { AiAdapterError } from "@/adapters/openai/client";
import { interviewSessionIdSchema } from "@/contracts/domain/ids";
import { idempotencyKeySchema } from "@/contracts/http/v1/common";
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
  readJsonBody,
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
  if (error instanceof EligibilityError || error instanceof InterviewError) {
    return createErrorResponse(error.code);
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

function requireIdempotencyKey(request: Request): string {
  const result = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!result.success) {
    throw new RequestBoundaryError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return result.data;
}

function clientIp(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  const candidate = forwarded?.trim();
  return candidate && candidate.length <= 128 && isIP(candidate)
    ? candidate
    : "0.0.0.0";
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
          ipAddress: clientIp(request),
        }),
        { status: 201 },
      );
    } catch (error) {
      return safeError(error);
    }
  };
}
