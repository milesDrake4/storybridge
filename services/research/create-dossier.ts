import { AiAdapterError } from "@/adapters/openai/structured-response";
import type { SchoolResearchPort } from "@/adapters/openai/school-research";
import { schoolDossierIdSchema, type EssayId } from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
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

type ResearchErrorCode = Extract<
  ErrorCode,
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "SERVICE_UNAVAILABLE"
  | "STATE_CONFLICT"
>;

export class SchoolDossierError extends Error {
  readonly code: ResearchErrorCode;

  constructor(code: ResearchErrorCode) {
    super(code);
    this.name = "SchoolDossierError";
    this.code = code;
  }
}

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
  research: SchoolResearchPort;
};

export type SchoolDossierResult = {
  dossier: SchoolDossier;
  essayRevision: number;
};

export async function getEssayDossier(
  essayId: EssayId,
  dependencies: Dependencies,
  now = new Date(),
): Promise<SchoolDossier> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const dossier = await dependencies.dossiers.findByEssay(userId, essayId);
  if (!dossier) throw new SchoolDossierError("RESOURCE_NOT_FOUND");
  return dossier;
}

export async function createEssayDossier(
  essayId: EssayId,
  request: { idempotencyKey: string; ipAddress: string },
  dependencies: Dependencies,
  now = new Date(),
): Promise<SchoolDossierResult> {
  return generateEssayDossier(essayId, request, dependencies, now);
}

export async function generateEssayDossier(
  essayId: EssayId,
  request: {
    expectedRevision?: number;
    idempotencyKey: string;
    ipAddress: string;
  },
  dependencies: Dependencies,
  now = new Date(),
): Promise<SchoolDossierResult> {
  const { userId } = await requireProductEligibility(dependencies, now);
  const workspace = await dependencies.essays.get(userId, essayId);
  if (!workspace) throw new SchoolDossierError("RESOURCE_NOT_FOUND");
  const refresh = request.expectedRevision !== undefined;
  if (refresh && workspace.essay.dossierId === null) {
    throw new SchoolDossierError("STATE_CONFLICT");
  }
  if (refresh && workspace.essay.revision !== request.expectedRevision) {
    throw new SchoolDossierError("REVISION_MISMATCH");
  }
  const reservation = await reserveAiOperation(
    {
      canonicalRequest: JSON.stringify({
        essayId,
        refresh,
        schoolId: workspace.school.id,
        ...(refresh ? { expectedRevision: request.expectedRevision } : {}),
      }),
      essayId,
      estimatedCostCents: 25,
      idempotencyKey: request.idempotencyKey,
      ipAddress: request.ipAddress,
      method: "POST",
      purpose: "SCHOOL_RESEARCH",
      route: "/api/v1/essays/{essayId}/research",
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
      reservation.resource?.type !== "SCHOOL_DOSSIER"
    ) {
      throw new AiOperationError("STATE_CONFLICT");
    }
    const dossierId = schoolDossierIdSchema.safeParse(reservation.resource.id);
    if (!dossierId.success) throw new AiOperationError("STATE_CONFLICT");
    const replayed = await dependencies.dossiers.findById(
      userId,
      dossierId.data,
    );
    if (!replayed) throw new AiOperationError("STATE_CONFLICT");
    return { dossier: replayed, essayRevision: workspace.essay.revision };
  }

  await startAiOperation(
    reservation.operationId,
    dependencies.aiOperations,
    now,
  );
  const startedAt = Date.now();
  let generation;
  try {
    generation = await dependencies.research.research({
      school: workspace.school,
      userId,
    });
  } catch (error) {
    const adapterError =
      error instanceof AiAdapterError
        ? error
        : new AiAdapterError("SERVICE_UNAVAILABLE");
    await finalizeAiOperation(
      {
        finalCostCents: 25,
        httpStatus:
          adapterError.code === "PROVIDER_REFUSED" ||
          adapterError.code === "PROVIDER_INVALID_RESPONSE"
            ? 502
            : 503,
        inputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelId: null,
        operationId: reservation.operationId,
        outputTokens: null,
        providerRequestId: null,
        safeErrorCode: adapterError.code,
        status:
          adapterError.code === "PROVIDER_REFUSED"
            ? "REFUSED"
            : adapterError.code === "PROVIDER_INVALID_RESPONSE"
              ? "FAILED"
              : "UNKNOWN",
      },
      dependencies.aiOperations,
      now,
    );
    const publicCode =
      adapterError.code === "PROVIDER_TIMEOUT"
        ? "SERVICE_UNAVAILABLE"
        : adapterError.code;
    throw new SchoolDossierError(publicCode);
  }

  const completion = {
    finalCostCents: 25,
    inputTokens: generation.usage.inputTokens,
    latencyMs: Math.max(0, Date.now() - startedAt),
    modelId: generation.model,
    operationId: reservation.operationId,
    outputTokens: generation.usage.outputTokens,
    providerRequestId: generation.requestId,
  };
  let committed: Awaited<ReturnType<SchoolDossierRepository["commit"]>>;
  try {
    const commit = {
      ...completion,
      draft: generation.value,
      essayId,
      now,
      userId,
    };
    committed = refresh
      ? await dependencies.dossiers.refresh({
          ...commit,
          expectedRevision: request.expectedRevision!,
        })
      : await dependencies.dossiers.commit(commit);
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
  if (
    committed.type === "NOT_FOUND" ||
    committed.type === "REVISION_MISMATCH" ||
    committed.type === "STATE_CONFLICT"
  ) {
    const code =
      committed.type === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : committed.type === "REVISION_MISMATCH"
          ? "REVISION_MISMATCH"
          : "STATE_CONFLICT";
    await finalizeAiOperation(
      {
        ...completion,
        httpStatus:
          code === "RESOURCE_NOT_FOUND"
            ? 404
            : code === "REVISION_MISMATCH"
              ? 412
              : 409,
        safeErrorCode: code,
        status: "FAILED",
      },
      dependencies.aiOperations,
      now,
    );
    throw new SchoolDossierError(code);
  }
  return {
    dossier: committed.value,
    essayRevision: committed.essayRevision,
  };
}
