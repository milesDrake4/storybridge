import type {
  ModerationPort,
  ModerationSignal,
} from "@/contracts/domain/ai-ports";
import {
  interviewMessageIdSchema,
  type InterviewSessionId,
} from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import {
  interviewAnswerInputSchema,
  type InterviewAnswerInput,
  type InterviewSession,
  type InterviewSessionWithMessages,
  type InterviewTurn,
} from "@/contracts/http/v1/interviews";
import { normalizePlainText } from "@/lib/security/request-boundary";
import type { HmacSecrets } from "@/lib/config/server";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import {
  InterviewSequenceError,
  type InterviewRepository,
} from "@/repositories/interview-repository";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";
import {
  AiOperationError,
  finalizeAiOperation,
  reserveAiOperation,
  startAiOperation,
} from "@/services/ai/reserve-operation";

export class InterviewError extends Error {
  readonly code: Extract<
    ErrorCode,
    "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" | "VALIDATION_ERROR"
  >;
  readonly safetyKind?: "MINOR_SEXUAL" | "SELF_HARM";

  constructor(
    code: Extract<
      ErrorCode,
      "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" | "VALIDATION_ERROR"
    >,
    safetyKind?: "MINOR_SEXUAL" | "SELF_HARM",
  ) {
    super(code);
    this.name = "InterviewError";
    this.code = code;
    this.safetyKind = safetyKind;
  }
}

type InterviewDependencies = EligibilityDependencies & {
  interviews: InterviewRepository;
};

type InterviewAnswerDependencies = InterviewDependencies & {
  aiOperations: AiOperationRepository;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  moderation: ModerationPort;
};

export type InterviewAnswerRequest = {
  idempotencyKey: string;
  ipAddress: string;
};

export async function startInterview(
  dependencies: InterviewDependencies,
  now = new Date(),
): Promise<InterviewSession> {
  const { userId } = await requireProductEligibility(dependencies, now);
  return dependencies.interviews.start(userId, now);
}

export async function getCurrentInterview(
  dependencies: InterviewDependencies,
  now = new Date(),
): Promise<InterviewSessionWithMessages> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const session = await dependencies.interviews.getCurrent(userId);
  if (!session) throw new InterviewError("RESOURCE_NOT_FOUND");
  return session;
}

export async function answerInterview(
  sessionId: InterviewSessionId,
  input: InterviewAnswerInput,
  request: InterviewAnswerRequest,
  dependencies: InterviewAnswerDependencies,
  now = new Date(),
): Promise<InterviewTurn> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const parsed = interviewAnswerInputSchema.parse({
    ...input,
    answer: normalizePlainText(input.answer).trim(),
  });
  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        answer: parsed.answer,
        questionKey: parsed.questionKey,
        sessionId,
      }),
      estimatedCostCents: 0,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "INTERVIEW_REPLY",
      route: "/api/v1/interview-sessions/{sessionId}/messages",
      userId,
    },
    {
      hmacSecrets: dependencies.hmacSecrets,
      limits: dependencies.limits,
      now: () => now,
      repository: dependencies.aiOperations,
    },
  );
  if (reservation.type === "REPLAY") {
    if (
      reservation.status !== "SUCCEEDED" ||
      reservation.resource?.type !== "INTERVIEW_TURN"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const answerId = interviewMessageIdSchema.safeParse(
      reservation.resource.id,
    );
    if (!answerId.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.interviews.getTurn(
      userId,
      answerId.data,
    );
    if (!replayed) throw new AiOperationError("STATE_CONFLICT");
    return replayed;
  }

  await startAiOperation(
    reservation.operationId,
    dependencies.aiOperations,
    now,
  );
  const startedAt = Date.now();
  let signal: ModerationSignal;
  try {
    signal = await dependencies.moderation.check({
      content: [parsed.answer],
      purpose: "INTERVIEW_REPLY",
      userId,
    });
  } catch (error) {
    await finalizeAiOperation(
      {
        finalCostCents: 0,
        httpStatus: 503,
        inputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: null,
        operationId: reservation.operationId,
        outputTokens: null,
        providerRequestId: null,
        safeErrorCode: "SERVICE_UNAVAILABLE",
        status: "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    );
    throw error;
  }

  async function finalizeSafetyBlock(
    kind: "MINOR_SEXUAL" | "SELF_HARM",
  ): Promise<never> {
    await finalizeAiOperation(
      {
        finalCostCents: 0,
        httpStatus: 422,
        inputTokens: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: signal.model,
        operationId: reservation.operationId,
        outputTokens: 0,
        providerRequestId: signal.requestId,
        safeErrorCode: "VALIDATION_ERROR",
        status: "REFUSED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new InterviewError("VALIDATION_ERROR", kind);
  }

  if (signal.categories.includes("sexual/minors")) {
    return finalizeSafetyBlock("MINOR_SEXUAL");
  }
  if (signal.categories.some((category) => category.startsWith("self-harm"))) {
    return finalizeSafetyBlock("SELF_HARM");
  }

  let turn: InterviewTurn | null;
  try {
    turn = await dependencies.interviews.recordAnswer({
      answer: parsed.answer,
      now,
      questionKey: parsed.questionKey,
      sessionId,
      userId,
    });
  } catch (error) {
    if (error instanceof InterviewSequenceError) {
      await finalizeAiOperation(
        {
          finalCostCents: 0,
          httpStatus: 409,
          inputTokens: 0,
          latencyMs: Math.max(0, Date.now() - startedAt),
          modelId: signal.model,
          operationId: reservation.operationId,
          outputTokens: 0,
          providerRequestId: signal.requestId,
          safeErrorCode: "STATE_CONFLICT",
          status: "FAILED",
        },
        dependencies.aiOperations,
        now,
      );
      throw new InterviewError("STATE_CONFLICT");
    }
    await finalizeAiOperation(
      {
        finalCostCents: 0,
        httpStatus: 500,
        inputTokens: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: signal.model,
        operationId: reservation.operationId,
        outputTokens: 0,
        providerRequestId: signal.requestId,
        safeErrorCode: "INTERNAL_ERROR",
        status: "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    );
    throw error;
  }
  if (!turn) {
    await finalizeAiOperation(
      {
        finalCostCents: 0,
        httpStatus: 404,
        inputTokens: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: signal.model,
        operationId: reservation.operationId,
        outputTokens: 0,
        providerRequestId: signal.requestId,
        safeErrorCode: "RESOURCE_NOT_FOUND",
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new InterviewError("RESOURCE_NOT_FOUND");
  }
  await finalizeAiOperation(
    {
      finalCostCents: 0,
      httpStatus: 201,
      inputTokens: 0,
      latencyMs: Math.max(0, Date.now() - startedAt),
      modelId: signal.model,
      operationId: reservation.operationId,
      outputTokens: 0,
      providerRequestId: signal.requestId,
      resource: { id: turn.answer.id, type: "INTERVIEW_TURN" },
      status: "SUCCEEDED",
    },
    dependencies.aiOperations,
    now,
  );
  return turn;
}
