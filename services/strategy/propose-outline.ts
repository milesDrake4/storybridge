import type { OutlineGenerationPort } from "@/adapters/openai/outline-generator";
import { AiAdapterError } from "@/adapters/openai/structured-response";
import { aiProposalIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { OutlineProposal } from "@/contracts/http/v1/outlines";
import type { HmacSecrets } from "@/lib/config/server";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { OutlineProposalRepository } from "@/repositories/outline-proposal-repository";
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

type OutlineErrorCode = Extract<
  ErrorCode,
  | "INSUFFICIENT_EVIDENCE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
>;

export class OutlineProposalError extends Error {
  readonly code: OutlineErrorCode;
  constructor(code: OutlineErrorCode) {
    super(code);
    this.name = "OutlineProposalError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  aiOperations: AiOperationRepository;
  angles: EssayAngleRepository;
  dossiers: SchoolDossierRepository;
  essays: EssayWorkspaceRepository;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  outlineGenerator: OutlineGenerationPort;
  outlineProposals: OutlineProposalRepository;
  vault: StoryVaultRepository;
};

function providerCode(error: AiAdapterError): OutlineErrorCode {
  if (error.code === "PROVIDER_REFUSED") return "PROVIDER_REFUSED";
  if (error.code === "PROVIDER_INVALID_RESPONSE") {
    return "PROVIDER_INVALID_RESPONSE";
  }
  return "SERVICE_UNAVAILABLE";
}

export async function proposeEssayOutline(
  essayId: EssayId,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<OutlineProposal> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (
    !workspace ||
    !workspace.essay.dossierId ||
    !workspace.essay.selectedAngleId
  ) {
    throw new OutlineProposalError("RESOURCE_NOT_FOUND");
  }
  const [angles, dossier, facts] = await Promise.all([
    dependencies.angles.list(userId, essayId),
    dependencies.dossiers.findByEssay(userId, essayId),
    dependencies.vault.getFactsForAi(userId),
  ]);
  const angle = angles.find(
    (candidate) => candidate.id === workspace.essay.selectedAngleId,
  );
  if (!angle || !dossier || dossier.id !== workspace.essay.dossierId) {
    throw new OutlineProposalError("STATE_CONFLICT");
  }
  const relevantFacts = facts.filter((fact) =>
    angle.storyFactIds.includes(fact.id),
  );
  if (relevantFacts.length === 0) {
    throw new OutlineProposalError("INSUFFICIENT_EVIDENCE");
  }

  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        angleId: angle.id,
        dossierId: dossier.id,
        essayId,
        targetRevision: workspace.essay.revision,
      }),
      essayId,
      estimatedCostCents: 20,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "OUTLINE_GENERATION",
      route: "/api/v1/essays/{essayId}/outline-proposals",
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
      reservation.resource?.type !== "OUTLINE_PROPOSAL"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const id = aiProposalIdSchema.safeParse(reservation.resource.id);
    if (!id.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.outlineProposals.findById(
      userId,
      id.data,
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
  let generation;
  try {
    generation = await dependencies.outlineGenerator.generate({
      angle,
      dossier,
      facts: relevantFacts,
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
    throw new OutlineProposalError(code);
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
  const allowedFacts = new Set(relevantFacts.map((fact) => fact.id));
  const allowedSources = new Set(angle.schoolSourceIds);
  const totalWords = generation.value.outline.sections.reduce(
    (total, section) => total + section.targetWords,
    0,
  );
  const invalid =
    totalWords < Math.ceil(workspace.essay.wordLimit * 0.9) ||
    totalWords > Math.floor(workspace.essay.wordLimit * 1.1) ||
    generation.value.outline.sections.some(
      (section) =>
        section.storyFactIds.some((id) => !allowedFacts.has(id)) ||
        section.schoolSourceIds.some((id) => !allowedSources.has(id)),
    );
  if (invalid) {
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
    throw new OutlineProposalError("PROVIDER_INVALID_RESPONSE");
  }

  let committed;
  try {
    committed = await dependencies.outlineProposals.commit({
      ...completion,
      angleId: angle.id,
      dossierId: dossier.id,
      draft: generation.value,
      essayId,
      now,
      targetRevision: workspace.essay.revision,
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
      committed.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : committed.type === "REVISION_MISMATCH"
          ? "REVISION_MISMATCH"
          : committed.type === "EVIDENCE_INVALID"
            ? "PROVIDER_INVALID_RESPONSE"
            : "STATE_CONFLICT";
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus:
          code === "RESOURCE_NOT_FOUND"
            ? 404
            : code === "REVISION_MISMATCH"
              ? 412
              : code === "PROVIDER_INVALID_RESPONSE"
                ? 502
                : 409,
        safeErrorCode: code,
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new OutlineProposalError(code);
  }
  return committed.value;
}
