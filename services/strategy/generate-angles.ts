import { AiAdapterError } from "@/adapters/openai/structured-response";
import type { AngleGenerationPort } from "@/adapters/openai/angle-generator";
import type { EssayAngle } from "@/contracts/domain/essay-angle";
import type { EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
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

type AngleErrorCode = Extract<
  ErrorCode,
  | "INSUFFICIENT_EVIDENCE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "RESOURCE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
>;

export class EssayAngleError extends Error {
  readonly code: AngleErrorCode;
  readonly followUpQuestion?: string;

  constructor(code: AngleErrorCode, followUpQuestion?: string) {
    super(code);
    this.name = "EssayAngleError";
    this.code = code;
    this.followUpQuestion = followUpQuestion;
  }
}

type Dependencies = EligibilityDependencies & {
  aiOperations: AiOperationRepository;
  angles: EssayAngleRepository;
  dossiers: SchoolDossierRepository;
  essays: EssayWorkspaceRepository;
  generator: AngleGenerationPort;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  vault: StoryVaultRepository;
};

const defaultFollowUp =
  "What specific experience changed how you think, act, or contribute to a community?";

function providerCode(error: AiAdapterError): AngleErrorCode {
  if (error.code === "PROVIDER_REFUSED") return "PROVIDER_REFUSED";
  if (error.code === "PROVIDER_INVALID_RESPONSE") {
    return "PROVIDER_INVALID_RESPONSE";
  }
  return "SERVICE_UNAVAILABLE";
}

export async function generateEssayAngles(
  essayId: EssayId,
  input: { regenerate: boolean },
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<[EssayAngle, EssayAngle, EssayAngle]> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace || !workspace.essay.dossierId) {
    throw new EssayAngleError("RESOURCE_NOT_FOUND");
  }
  const [dossier, facts] = await Promise.all([
    dependencies.dossiers.findByEssay(userId, essayId),
    dependencies.vault.getFactsForAi(userId),
  ]);
  if (!dossier || dossier.id !== workspace.essay.dossierId) {
    throw new EssayAngleError("STATE_CONFLICT");
  }
  if (facts.length === 0) {
    throw new EssayAngleError("INSUFFICIENT_EVIDENCE", defaultFollowUp);
  }

  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        dossierId: dossier.id,
        essayId,
        regenerate: input.regenerate,
      }),
      essayId,
      estimatedCostCents: 20,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "ANGLE_GENERATION",
      route: "/api/v1/essays/{essayId}/angles",
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
      reservation.resource?.type !== "ESSAY_ANGLE_SET" ||
      reservation.resource.id !== essayId
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const replayed = await dependencies.angles.list(userId, essayId);
    if (replayed.length !== 3) throw new AiOperationError("STATE_CONFLICT");
    return [replayed[0], replayed[1], replayed[2]];
  }

  await startAiOperation(
    reservation.operationId,
    dependencies.aiOperations,
    now,
  );
  const startedAt = Date.now();
  let generation;
  try {
    generation = await dependencies.generator.generate({
      dossier,
      facts,
      prompt: workspace.essay.prompt,
      userId,
      wordLimit: workspace.essay.wordLimit,
    });
  } catch (error) {
    const adapterError =
      error instanceof AiAdapterError
        ? error
        : new AiAdapterError("SERVICE_UNAVAILABLE");
    const code = providerCode(adapterError);
    await finalizeAiOperation(
      {
        finalCostCents: 20,
        httpStatus: code === "SERVICE_UNAVAILABLE" ? 503 : 502,
        inputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: null,
        operationId: reservation.operationId,
        outputTokens: null,
        providerRequestId: null,
        safeErrorCode: adapterError.code,
        status: code === "PROVIDER_REFUSED" ? "REFUSED" : "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new EssayAngleError(code);
  }

  const completion = {
    finalCostCents: 20,
    inputTokens: generation.usage.inputTokens,
    latencyMs: Math.max(0, Date.now() - startedAt),
    modelId: generation.model,
    operationId: reservation.operationId,
    outputTokens: generation.usage.outputTokens,
    providerRequestId: generation.requestId,
  };

  if (generation.value.status === "INSUFFICIENT_EVIDENCE") {
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus: 422,
        safeErrorCode: "INSUFFICIENT_EVIDENCE",
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new EssayAngleError(
      "INSUFFICIENT_EVIDENCE",
      generation.value.followUpQuestion ?? defaultFollowUp,
    );
  }

  const allowedFacts = new Set(facts.map((fact) => fact.id));
  const allowedSources = new Set(dossier.sources.map((source) => source.id));
  const invalidEvidence = generation.value.angles.some(
    (angle) =>
      angle.storyFactIds.some((id) => !allowedFacts.has(id)) ||
      angle.schoolSourceIds.some((id) => !allowedSources.has(id)),
  );
  if (invalidEvidence) {
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus: 502,
        safeErrorCode: "PROVIDER_INVALID_RESPONSE",
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new EssayAngleError("PROVIDER_INVALID_RESPONSE");
  }

  if (generation.value.angles.length !== 3) {
    throw new EssayAngleError("PROVIDER_INVALID_RESPONSE");
  }

  let committed;
  try {
    committed = await dependencies.angles.commit({
      ...completion,
      angles: [
        generation.value.angles[0],
        generation.value.angles[1],
        generation.value.angles[2],
      ],
      dossierId: dossier.id,
      essayId,
      now,
      regenerate: input.regenerate,
      userId,
    });
  } catch (error) {
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus: 500,
        safeErrorCode: "INTERNAL_ERROR",
        status: "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    ).catch(() => undefined);
    throw error;
  }

  if (committed.type !== "CREATED" && committed.type !== "REPLAY") {
    const code =
      committed.type === "EVIDENCE_INVALID"
        ? "PROVIDER_INVALID_RESPONSE"
        : committed.type === "NOT_FOUND"
          ? "RESOURCE_NOT_FOUND"
          : "STATE_CONFLICT";
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus:
          code === "RESOURCE_NOT_FOUND"
            ? 404
            : code === "PROVIDER_INVALID_RESPONSE"
              ? 502
              : 409,
        safeErrorCode: code,
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new EssayAngleError(code);
  }
  return committed.value;
}
