import {
  AiAdapterError,
  createZodStructuredOutput,
} from "@/adapters/openai/client";
import type { StructuredGenerationPort } from "@/contracts/domain/ai-ports";
import {
  storyProfileIdSchema,
  type InterviewSessionId,
} from "@/contracts/domain/ids";
import {
  storyExtractionSchema,
  type StoryExtraction,
  type StoryProfile,
} from "@/contracts/domain/story-vault";
import type { InterviewQuestionKey } from "@/contracts/http/v1/interviews";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import { createContentHmac } from "@/lib/security/hmac";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import {
  AiOperationError,
  finalizeAiOperation,
  reserveAiOperation,
  startAiOperation,
} from "@/services/ai/reserve-operation";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type ExtractionErrorCode = Extract<
  ErrorCode,
  "INSUFFICIENT_EVIDENCE" | "PROVIDER_INVALID_RESPONSE" | "RESOURCE_NOT_FOUND"
>;

export class StoryExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly targetQuestionKey?: InterviewQuestionKey;

  constructor(
    code: ExtractionErrorCode,
    targetQuestionKey?: InterviewQuestionKey,
  ) {
    super(code);
    this.name = "StoryExtractionError";
    this.code = code;
    this.targetQuestionKey = targetQuestionKey;
  }
}

export type StoryExtractionRequest = {
  idempotencyKey: string;
  ipAddress: string;
};

type Dependencies = EligibilityDependencies & {
  aiOperations: AiOperationRepository;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  structured: StructuredGenerationPort;
  vault: StoryVaultRepository;
};

const extractionOutput = createZodStructuredOutput(
  "story_profile_extraction",
  storyExtractionSchema,
);

const EXTRACTION_INSTRUCTIONS = `You extract only explicit, non-sensitive student facts from an interview transcript.
Every fact must be directly supported by one or more USER message IDs from the input.
Do not infer or assert health, disability, race, ethnicity, religion, sexual orientation, gender identity, immigration status, finances, or other sensitive traits.
Do not turn uncertainty into fact. Omit anything ambiguous instead of guessing.
Set certainty to EXPLICIT and sensitive to false for every included fact.
Summaries and details must remain faithful to the student's own meaning and must not embellish achievements.
Describe voice only from explicit writing characteristics in the transcript.`;

function hasMinimumCoverage(coverage: {
  academicInterests: boolean;
  experiences: number;
  goals: boolean;
  values: boolean;
  voice: boolean;
}): boolean {
  return (
    coverage.academicInterests &&
    coverage.experiences >= 2 &&
    coverage.goals &&
    coverage.values &&
    coverage.voice
  );
}

function invalidExtraction(): StoryExtractionError {
  return new StoryExtractionError("PROVIDER_INVALID_RESPONSE");
}

export async function extractStoryProfile(
  sessionId: InterviewSessionId,
  request: StoryExtractionRequest,
  dependencies: Dependencies,
  now = new Date(),
): Promise<StoryProfile> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const existing = await dependencies.vault.findBySession(userId, sessionId);
  if (existing) return existing;

  const interview = await dependencies.vault.getInterview(userId, sessionId);
  if (!interview) throw new StoryExtractionError("RESOURCE_NOT_FOUND");
  if (
    interview.status !== "COMPLETE" ||
    !hasMinimumCoverage(interview.coverage)
  ) {
    throw new StoryExtractionError(
      "INSUFFICIENT_EVIDENCE",
      interview.currentQuestionKey ?? undefined,
    );
  }

  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({ sessionId }),
      estimatedCostCents: 25,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "STORY_EXTRACTION",
      route: "/api/v1/interview-sessions/{sessionId}/complete",
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
      reservation.resource?.type !== "STORY_PROFILE"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const profileId = storyProfileIdSchema.safeParse(reservation.resource.id);
    if (!profileId.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.vault.findById(userId, profileId.data);
    if (!replayed) throw new AiOperationError("STATE_CONFLICT");
    return replayed;
  }

  await startAiOperation(
    reservation.operationId,
    dependencies.aiOperations,
    now,
  );
  const startedAt = Date.now();
  let generation;
  try {
    generation = await dependencies.structured.generate({
      input: JSON.stringify({
        messages: interview.messages.map((message) => ({
          content: message.content,
          id: message.id,
          questionKey: message.questionKey,
          role: message.role,
        })),
      }),
      instructions: EXTRACTION_INSTRUCTIONS,
      output: extractionOutput,
      purpose: "STORY_EXTRACTION",
      userId,
    });
  } catch (error) {
    const adapterError = error instanceof AiAdapterError ? error : null;
    await finalizeAiOperation(
      {
        finalCostCents: 25,
        httpStatus: adapterError?.code === "PROVIDER_REFUSED" ? 502 : 503,
        inputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: null,
        operationId: reservation.operationId,
        outputTokens: null,
        providerRequestId: null,
        safeErrorCode: adapterError?.code ?? "SERVICE_UNAVAILABLE",
        status:
          adapterError?.code === "PROVIDER_REFUSED"
            ? "REFUSED"
            : adapterError?.code === "PROVIDER_INVALID_RESPONSE"
              ? "FAILED"
              : "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    );
    throw error;
  }

  let extraction: StoryExtraction;
  try {
    extraction = storyExtractionSchema.parse(generation.value);
    const ownedUserMessageIds = new Set(
      interview.messages
        .filter((message) => message.role === "USER")
        .map((message) => message.id),
    );
    if (
      extraction.facts.some(
        (fact) =>
          fact.sourceMessageIds.some(
            (messageId) => !ownedUserMessageIds.has(messageId),
          ) ||
          new Set(fact.sourceMessageIds).size !== fact.sourceMessageIds.length,
      )
    ) {
      throw invalidExtraction();
    }
  } catch {
    await finalizeAiOperation(
      {
        finalCostCents: 25,
        httpStatus: 502,
        inputTokens: generation.usage.inputTokens,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: generation.model,
        operationId: reservation.operationId,
        outputTokens: generation.usage.outputTokens,
        providerRequestId: generation.requestId,
        safeErrorCode: "PROVIDER_INVALID_RESPONSE",
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw invalidExtraction();
  }

  let created;
  try {
    created = await dependencies.vault.create({
      facts: extraction.facts.map((fact) => ({
        category: fact.category,
        contentHmac: createContentHmac(
          JSON.stringify({
            category: fact.category,
            details: fact.details,
            sourceMessageIds: fact.sourceMessageIds,
            summary: fact.summary,
          }),
          dependencies.hmacSecrets,
        ),
        details: fact.details,
        sourceMessageIds: fact.sourceMessageIds,
        summary: fact.summary,
      })),
      now,
      sessionId,
      userId,
      voiceProfile: extraction.voiceProfile,
    });
  } catch (error) {
    await finalizeAiOperation(
      {
        finalCostCents: 25,
        httpStatus: 500,
        inputTokens: generation.usage.inputTokens,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: generation.model,
        operationId: reservation.operationId,
        outputTokens: generation.usage.outputTokens,
        providerRequestId: generation.requestId,
        safeErrorCode: "INTERNAL_ERROR",
        status: "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    );
    throw error;
  }

  if (created.type !== "CREATED" && created.type !== "REPLAY") {
    const code =
      created.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : "INSUFFICIENT_EVIDENCE";
    await finalizeAiOperation(
      {
        finalCostCents: 25,
        httpStatus: code === "RESOURCE_NOT_FOUND" ? 404 : 422,
        inputTokens: generation.usage.inputTokens,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: generation.model,
        operationId: reservation.operationId,
        outputTokens: generation.usage.outputTokens,
        providerRequestId: generation.requestId,
        safeErrorCode: code,
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new StoryExtractionError(code);
  }

  await finalizeAiOperation(
    {
      finalCostCents: 25,
      httpStatus: 201,
      inputTokens: generation.usage.inputTokens,
      latencyMs: Math.max(0, Date.now() - startedAt),
      modelId: generation.model,
      operationId: reservation.operationId,
      outputTokens: generation.usage.outputTokens,
      providerRequestId: generation.requestId,
      resource: { id: created.profile.id, type: "STORY_PROFILE" },
      status: "SUCCEEDED",
    },
    dependencies.aiOperations,
    now,
  );
  return created.profile;
}
