import type { CoachGenerationPort } from "@/adapters/openai/coach";
import { AiAdapterError } from "@/adapters/openai/structured-response";
import type { ModerationPort } from "@/contracts/domain/ai-ports";
import { aiProposalIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { AdviceProposal, CoachInput } from "@/contracts/http/v1/proposals";
import type { HmacSecrets } from "@/lib/config/server";
import type { AdviceProposalRepository } from "@/repositories/advice-proposal-repository";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
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

type AdviceErrorCode = Extract<
  ErrorCode,
  | "INSUFFICIENT_EVIDENCE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
  | "VALIDATION_ERROR"
>;

export class AdviceProposalError extends Error {
  readonly code: AdviceErrorCode;
  constructor(code: AdviceErrorCode) {
    super(code);
    this.name = "AdviceProposalError";
    this.code = code;
  }
}

type Dependencies = EligibilityDependencies & {
  adviceProposals: AdviceProposalRepository;
  aiOperations: AiOperationRepository;
  coachGenerator: CoachGenerationPort;
  dossiers: SchoolDossierRepository;
  essays: EssayWorkspaceRepository;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  moderation: ModerationPort;
  vault: StoryVaultRepository;
};

export async function proposeAdvice(
  essayId: EssayId,
  input: CoachInput,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<AdviceProposal> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new AdviceProposalError("RESOURCE_NOT_FOUND");
  if (!workspace.essay.dossierId || !workspace.essay.outline) {
    throw new AdviceProposalError("STATE_CONFLICT");
  }
  const [dossier, facts] = await Promise.all([
    dependencies.dossiers.findByEssay(userId, essayId),
    dependencies.vault.getFactsForAi(userId),
  ]);
  if (!dossier || dossier.id !== workspace.essay.dossierId || !facts.length) {
    throw new AdviceProposalError("INSUFFICIENT_EVIDENCE");
  }

  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        essayId,
        question: input.question,
        targetRevision: workspace.essay.revision,
      }),
      essayId,
      estimatedCostCents: 15,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "COACHING",
      route: "/api/v1/essays/{essayId}/coach-proposals",
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
      reservation.resource?.type !== "ADVICE_PROPOSAL"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const id = aiProposalIdSchema.safeParse(reservation.resource.id);
    if (!id.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.adviceProposals.findById(
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
  const fail = async (
    code: AdviceErrorCode,
    status: "FAILED" | "REFUSED" | "UNKNOWN",
  ) => {
    await finalizeAiOperation(
      {
        finalCostCents: 0,
        httpStatus:
          code === "VALIDATION_ERROR"
            ? 422
            : code === "SERVICE_UNAVAILABLE"
              ? 503
              : 502,
        inputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: null,
        operationId: reservation.operationId,
        outputTokens: null,
        providerRequestId: null,
        safeErrorCode: code,
        status,
      },
      dependencies.aiOperations,
      now,
    );
    throw new AdviceProposalError(code);
  };

  let moderation;
  try {
    moderation = await dependencies.moderation.check({
      content: [input.question, workspace.essay.draftText],
      purpose: "COACHING",
      userId,
    });
  } catch {
    return fail("SERVICE_UNAVAILABLE", "UNKNOWN");
  }
  if (moderation.flagged) return fail("VALIDATION_ERROR", "REFUSED");

  let generation;
  try {
    generation = await dependencies.coachGenerator.generate({
      dossier,
      essay: workspace.essay,
      facts,
      question: input.question,
      userId,
    });
  } catch (error) {
    const code =
      error instanceof AiAdapterError && error.code === "PROVIDER_REFUSED"
        ? "PROVIDER_REFUSED"
        : error instanceof AiAdapterError &&
            error.code === "PROVIDER_INVALID_RESPONSE"
          ? "PROVIDER_INVALID_RESPONSE"
          : "SERVICE_UNAVAILABLE";
    return fail(code, code === "PROVIDER_REFUSED" ? "REFUSED" : "FAILED");
  }

  let committed;
  try {
    committed = await dependencies.adviceProposals.commit({
      draft: generation.value,
      essayId,
      finalCostCents: 15,
      inputTokens: generation.usage.inputTokens,
      latencyMs: Math.max(0, Date.now() - startedAt),
      modelId: generation.model,
      now,
      operationId: reservation.operationId,
      outputTokens: generation.usage.outputTokens,
      providerRequestId: generation.requestId,
      targetRevision: workspace.essay.revision,
      userId,
    });
  } catch (error) {
    await finalizeAiOperation(
      {
        finalCostCents: 15,
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
    ).catch(() => undefined);
    throw error;
  }
  if (committed.type !== "CREATED" && committed.type !== "REPLAY") {
    const code =
      committed.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : committed.type === "REVISION_MISMATCH"
          ? "REVISION_MISMATCH"
          : "STATE_CONFLICT";
    return fail(code, "FAILED");
  }
  return committed.value;
}
