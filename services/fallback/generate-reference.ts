import type { ReferenceDraftGenerationPort } from "@/adapters/openai/reference-draft";
import { AiAdapterError } from "@/adapters/openai/structured-response";
import type { ModerationPort } from "@/contracts/domain/ai-ports";
import { aiProposalIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import {
  CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
  type ReferenceClaimDraft,
  type ReferenceDraftInput,
  type ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";
import type { HmacSecrets } from "@/lib/config/server";
import { sliceByCodePoints } from "@/lib/essay/apply-proposal";
import { createContentHmac } from "@/lib/security/hmac";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { ReferenceDraftRepository } from "@/repositories/reference-draft-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import {
  AiOperationError,
  finalizeAiOperation,
  releaseAiOperation,
  reserveAiOperation,
  startAiOperation,
} from "@/services/ai/reserve-operation";
import {
  requireProductEligibility,
  type EligibilityDependencies,
} from "@/services/auth/eligibility";

type ReferenceDraftErrorCode = Extract<
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

export class ReferenceDraftError extends Error {
  readonly code: ReferenceDraftErrorCode;
  constructor(code: ReferenceDraftErrorCode) {
    super(code);
    this.name = "ReferenceDraftError";
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
  moderation: ModerationPort;
  referenceDraftGenerator: ReferenceDraftGenerationPort;
  referenceDrafts: ReferenceDraftRepository;
  vault: StoryVaultRepository;
};

function providerCode(error: unknown): ReferenceDraftErrorCode {
  if (error instanceof AiAdapterError && error.code === "PROVIDER_REFUSED") {
    return "PROVIDER_REFUSED";
  }
  if (
    error instanceof AiAdapterError &&
    error.code === "PROVIDER_INVALID_RESPONSE"
  ) {
    return "PROVIDER_INVALID_RESPONSE";
  }
  return "SERVICE_UNAVAILABLE";
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function claimsAreValid(
  referenceText: string,
  claims: ReferenceClaimDraft[],
  factIds: Set<string>,
  sourceIds: Set<string>,
): boolean {
  const length = Array.from(referenceText).length;
  let previousEnd = -1;
  return claims.every((claim) => {
    const valid =
      claim.start >= previousEnd &&
      claim.end <= length &&
      sliceByCodePoints(referenceText, claim.start, claim.end) === claim.text &&
      claim.storyFactIds.every((id) => factIds.has(id)) &&
      claim.schoolSourceIds.every((id) => sourceIds.has(id));
    previousEnd = claim.end;
    return valid;
  });
}

export async function generateReferenceDraft(
  essayId: EssayId,
  input: ReferenceDraftInput,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<ReferenceDraftProposal> {
  if (
    input.acknowledgmentVersion !== CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION
  ) {
    throw new ReferenceDraftError("VALIDATION_ERROR");
  }
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new ReferenceDraftError("RESOURCE_NOT_FOUND");
  const { essay } = workspace;
  if (!essay.dossierId || !essay.selectedAngleId || !essay.outline) {
    throw new ReferenceDraftError("STATE_CONFLICT");
  }
  if (
    essay.outline.sections.length < 3 ||
    essay.outline.sections.some((section) => !section.purpose.trim())
  ) {
    throw new ReferenceDraftError("STATE_CONFLICT");
  }

  const [angles, dossier, profile, facts] = await Promise.all([
    dependencies.angles.list(userId, essayId),
    dependencies.dossiers.findByEssay(userId, essayId),
    dependencies.vault.getCurrent(userId),
    dependencies.vault.getFactsForAi(userId),
  ]);
  const angle = angles.find(
    (candidate) => candidate.id === essay.selectedAngleId,
  );
  if (
    !angle ||
    !dossier ||
    dossier.id !== essay.dossierId ||
    angle.dossierId !== dossier.id
  ) {
    throw new ReferenceDraftError("STATE_CONFLICT");
  }
  if (!profile) throw new ReferenceDraftError("INSUFFICIENT_EVIDENCE");

  const outlineFactIds = new Set(
    essay.outline.sections.flatMap((section) => section.storyFactIds),
  );
  const outlineSourceIds = new Set(
    essay.outline.sections.flatMap((section) => section.schoolSourceIds),
  );
  const allowedFacts = facts.filter(
    (fact) =>
      fact.profileId === profile.profile.id && outlineFactIds.has(fact.id),
  );
  const allowedSources = dossier.sources.filter((source) =>
    outlineSourceIds.has(source.id),
  );
  if (
    allowedFacts.length !== outlineFactIds.size ||
    allowedSources.length !== outlineSourceIds.size ||
    allowedFacts.length === 0 ||
    allowedSources.length === 0
  ) {
    throw new ReferenceDraftError("INSUFFICIENT_EVIDENCE");
  }

  try {
    const authored = [
      essay.prompt,
      ...essay.outline.sections.map((section) => section.purpose),
      ...allowedFacts.flatMap((fact) => [fact.summary, ...fact.details]),
    ];
    if (
      (
        await dependencies.moderation.check({
          content: authored,
          purpose: "REFERENCE_DRAFT",
          userId,
        })
      ).flagged
    ) {
      throw new ReferenceDraftError("VALIDATION_ERROR");
    }
  } catch (error) {
    if (error instanceof ReferenceDraftError) throw error;
    throw new ReferenceDraftError("SERVICE_UNAVAILABLE");
  }

  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        acknowledgmentVersion: input.acknowledgmentVersion,
        essayId,
        targetRevision: essay.revision,
      }),
      essayId,
      estimatedCostCents: 30,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "REFERENCE_DRAFT",
      route: "/api/v1/essays/{essayId}/reference-draft",
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
      reservation.resource?.type !== "REFERENCE_DRAFT_PROPOSAL"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const proposalId = aiProposalIdSchema.safeParse(reservation.resource.id);
    if (!proposalId.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.referenceDrafts.findById(
      userId,
      proposalId.data,
    );
    if (!replayed) throw new AiOperationError("STATE_CONFLICT");
    return replayed;
  }

  try {
    await startAiOperation(
      reservation.operationId,
      dependencies.aiOperations,
      now,
    );
  } catch (error) {
    const code =
      error instanceof AiOperationError ? error.code : "STATE_CONFLICT";
    await releaseAiOperation(
      reservation.operationId,
      code,
      code === "QUOTA_EXCEEDED" ? 429 : 503,
      dependencies.aiOperations,
      now,
    ).catch(() => undefined);
    throw error;
  }

  const startedAt = Date.now();
  let generation:
    | Awaited<ReturnType<ReferenceDraftGenerationPort["generate"]>>
    | undefined;
  const fail = async (
    code: ReferenceDraftErrorCode,
    status: "FAILED" | "REFUSED" | "UNKNOWN",
  ): Promise<never> => {
    await finalizeAiOperation(
      {
        finalCostCents: generation ? 30 : 0,
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
    throw new ReferenceDraftError(code);
  };

  try {
    generation = await dependencies.referenceDraftGenerator.generate({
      essay,
      facts: allowedFacts,
      outline: essay.outline,
      schoolSources: allowedSources,
      userId,
      voiceProfile: profile.profile.voiceProfile,
    });
  } catch (error) {
    const code = providerCode(error);
    return fail(code, code === "PROVIDER_REFUSED" ? "REFUSED" : "FAILED");
  }

  if (
    wordCount(generation.value.referenceText) > essay.wordLimit ||
    !claimsAreValid(
      generation.value.referenceText,
      generation.value.claims,
      new Set(allowedFacts.map((fact) => fact.id)),
      new Set(allowedSources.map((source) => source.id)),
    )
  ) {
    return fail("PROVIDER_INVALID_RESPONSE", "FAILED");
  }
  try {
    if (
      (
        await dependencies.moderation.check({
          content: [
            generation.value.referenceText,
            generation.value.rationale,
            ...generation.value.claims.map((claim) => claim.text),
          ],
          purpose: "REFERENCE_DRAFT",
          userId,
        })
      ).flagged
    ) {
      return fail("PROVIDER_REFUSED", "REFUSED");
    }
  } catch {
    return fail("SERVICE_UNAVAILABLE", "UNKNOWN");
  }

  const claims = generation.value.claims.map((claim) => ({
    ...claim,
    contentHmac: createContentHmac(
      JSON.stringify({ end: claim.end, start: claim.start, text: claim.text }),
      dependencies.hmacSecrets,
    ),
  }));
  let committed;
  try {
    committed = await dependencies.referenceDrafts.commit({
      acknowledgmentVersion: input.acknowledgmentVersion,
      claims,
      essayId,
      finalCostCents: 30,
      inputTokens: generation.usage.inputTokens,
      latencyMs: Math.max(0, Date.now() - startedAt),
      modelId: generation.model,
      now,
      operationId: reservation.operationId,
      outputTokens: generation.usage.outputTokens,
      providerRequestId: generation.requestId,
      rationale: generation.value.rationale,
      referenceText: generation.value.referenceText,
      targetRevision: essay.revision,
      userId,
    });
  } catch (error) {
    await finalizeAiOperation(
      {
        finalCostCents: 30,
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
    return fail(
      committed.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : committed.type === "REVISION_MISMATCH"
          ? "REVISION_MISMATCH"
          : committed.type === "EVIDENCE_INVALID"
            ? "INSUFFICIENT_EVIDENCE"
            : "STATE_CONFLICT",
      "FAILED",
    );
  }
  return committed.value;
}
