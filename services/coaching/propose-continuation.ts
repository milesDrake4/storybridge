import type { RevisionGenerationPort } from "@/adapters/openai/revision";
import type { ModerationPort } from "@/contracts/domain/ai-ports";
import { aiProposalIdSchema, type EssayId } from "@/contracts/domain/ids";
import type {
  ContinuationInput,
  ContinuationProposal,
} from "@/contracts/http/v1/proposals";
import type { HmacSecrets } from "@/lib/config/server";
import { createDraftTextHash } from "@/lib/security/draft-hash";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { RevisionProposalRepository } from "@/repositories/revision-proposal-repository";
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
import {
  claimsUseAllowedEvidence,
  proposalText,
  providerErrorCode,
  RevisionProposalError,
  type RevisionProposalErrorCode,
} from "@/services/coaching/revision-shared";

type Dependencies = EligibilityDependencies & {
  aiOperations: AiOperationRepository;
  dossiers: SchoolDossierRepository;
  essays: EssayWorkspaceRepository;
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  moderation: ModerationPort;
  revisionGenerator: RevisionGenerationPort;
  revisionProposals: RevisionProposalRepository;
  vault: StoryVaultRepository;
};

export async function proposeContinuation(
  essayId: EssayId,
  input: ContinuationInput,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<ContinuationProposal> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new RevisionProposalError("RESOURCE_NOT_FOUND");
  const { draftText } = workspace.essay;
  if (input.cursorOffset > Array.from(draftText).length)
    throw new RevisionProposalError("VALIDATION_ERROR");
  if (createDraftTextHash(draftText) !== input.contextHash)
    throw new RevisionProposalError("REVISION_MISMATCH");
  if (!workspace.essay.dossierId)
    throw new RevisionProposalError("STATE_CONFLICT");
  const [dossier, facts] = await Promise.all([
    dependencies.dossiers.findByEssay(userId, essayId),
    dependencies.vault.getFactsForAi(userId),
  ]);
  if (!dossier || dossier.id !== workspace.essay.dossierId || !facts.length)
    throw new RevisionProposalError("INSUFFICIENT_EVIDENCE");
  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        essayId,
        ...input,
        targetRevision: workspace.essay.revision,
      }),
      essayId,
      estimatedCostCents: 15,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "CONTINUATION",
      route: "/api/v1/essays/{essayId}/continuation-proposals",
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
      reservation.resource?.type !== "CONTINUATION_PROPOSAL"
    )
      throw new AiOperationError("STATE_CONFLICT");
    const id = aiProposalIdSchema.safeParse(reservation.resource.id);
    if (!id.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.revisionProposals.findContinuationById(
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
  let generation:
    | Awaited<ReturnType<RevisionGenerationPort["generateContinuation"]>>
    | undefined;
  const fail = async (
    code: RevisionProposalErrorCode,
    status: "FAILED" | "REFUSED" | "UNKNOWN",
  ) => {
    await finalizeAiOperation(
      {
        finalCostCents: generation ? 15 : 0,
        httpStatus:
          code === "VALIDATION_ERROR"
            ? 422
            : code === "SERVICE_UNAVAILABLE"
              ? 503
              : 502,
        inputTokens: generation?.usage.inputTokens ?? null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: generation?.model ?? null,
        operationId: reservation.operationId,
        outputTokens: generation?.usage.outputTokens ?? null,
        providerRequestId: generation?.requestId ?? null,
        safeErrorCode: code,
        status,
      },
      dependencies.aiOperations,
      now,
    );
    throw new RevisionProposalError(code);
  };
  try {
    if (
      (
        await dependencies.moderation.check({
          content: [draftText],
          purpose: "CONTINUATION",
          userId,
        })
      ).flagged
    )
      return fail("VALIDATION_ERROR", "REFUSED");
  } catch {
    return fail("SERVICE_UNAVAILABLE", "UNKNOWN");
  }
  try {
    generation = await dependencies.revisionGenerator.generateContinuation({
      cursorOffset: input.cursorOffset,
      dossier,
      essay: workspace.essay,
      facts,
      userId,
    });
  } catch (error) {
    const code = providerErrorCode(error);
    return fail(code, code === "PROVIDER_REFUSED" ? "REFUSED" : "FAILED");
  }
  const claims = generation.value.suggestions.flatMap(
    (suggestion) => suggestion.claims,
  );
  if (
    !claimsUseAllowedEvidence(
      claims,
      new Set(facts.map((fact) => fact.id)),
      new Set(dossier.sources.map((source) => source.id)),
    )
  )
    return fail("PROVIDER_INVALID_RESPONSE", "FAILED");
  try {
    if (
      (
        await dependencies.moderation.check({
          content: proposalText(
            claims,
            generation.value.suggestions.flatMap((suggestion) => [
              suggestion.proposedText,
              suggestion.rationale,
            ]),
          ),
          purpose: "CONTINUATION",
          userId,
        })
      ).flagged
    )
      return fail("PROVIDER_REFUSED", "REFUSED");
  } catch {
    return fail("SERVICE_UNAVAILABLE", "UNKNOWN");
  }
  let committed;
  try {
    committed = await dependencies.revisionProposals.commitContinuation({
      contextHash: input.contextHash,
      cursorOffset: input.cursorOffset,
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
  if (committed.type !== "CREATED" && committed.type !== "REPLAY")
    return fail(
      committed.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : committed.type === "REVISION_MISMATCH"
          ? "REVISION_MISMATCH"
          : "STATE_CONFLICT",
      "FAILED",
    );
  return committed.value;
}
