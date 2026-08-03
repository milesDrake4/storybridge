import { describe, expect, it, vi } from "vitest";

import { AiAdapterError } from "@/adapters/openai/structured-response";
import {
  createDossierGetHandler,
  createDossierPostHandler,
} from "@/app/api/v1/essays/research-handler";
import type {
  AiOperationId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
import { createEssayDossier } from "@/services/research/create-dossier";

const now = new Date("2026-08-03T18:00:00.000Z");
const appUrl = new URL("https://storybridge.test");
const userId = "a0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "a1000000-0000-4000-8000-000000000001" as EssayId;
const operationId = "a2000000-0000-4000-8000-000000000001" as AiOperationId;
const dossierId = "a3000000-0000-4000-8000-000000000001" as SchoolDossierId;
const school = {
  canonicalName: "University of Michigan",
  id: "a4000000-0000-4000-8000-000000000001",
  officialDomain: "umich.edu",
};
const draft = {
  schemaVersion: "1" as const,
  sources: [
    {
      category: "ACADEMICS" as const,
      claim: "Students can pursue interdisciplinary study.",
      normalizedUrl: "https://umich.edu/academics",
      retrievedAt: now.toISOString(),
      supportingExcerpt:
        "Students can pursue interdisciplinary study across schools.",
      title: "Academics",
    },
  ],
  summary: "Evidence-backed overview of academic opportunities.",
};
const dossier = {
  createdAt: now.toISOString(),
  essayId,
  id: dossierId,
  schemaVersion: "1",
  schoolId: school.id,
  sources: [
    { ...draft.sources[0], id: "a5000000-0000-4000-8000-000000000001" },
  ],
  summary: draft.summary,
  updatedAt: now.toISOString(),
  userId,
} as SchoolDossier;

function eligibility() {
  return {
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          createdAt: now.toISOString(),
          displayName: null,
          onboardingState: "COMPLETE" as const,
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
          updatedAt: now.toISOString(),
          userId,
        },
      }),
      recordConsent: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const aiOperations = {
    finalize: vi.fn().mockResolvedValue(true),
    release: vi.fn(),
    reserve: vi.fn().mockResolvedValue({
      operationId,
      resetAt: new Date("2026-08-04T00:00:00Z"),
      type: "RESERVED",
    }),
    start: vi.fn().mockResolvedValue("STARTED"),
  } satisfies AiOperationRepository;
  const essays = {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn().mockResolvedValue({
      essay: {
        createdAt: now.toISOString(),
        dossierId: null,
        id: essayId,
        prompt: "Describe a community that has shaped your perspective.",
        revision: 0,
        schoolId: school.id,
        season: "2026-2027",
        status: "STRATEGY",
        updatedAt: now.toISOString(),
        userId,
        wordLimit: 300,
      },
      school,
    }),
    list: vi.fn(),
  } as EssayWorkspaceRepository;
  const dossiers = {
    commit: vi
      .fn()
      .mockResolvedValue({ essayRevision: 1, type: "CREATED", value: dossier }),
    findByEssay: vi.fn().mockResolvedValue(dossier),
    findById: vi.fn().mockResolvedValue(dossier),
    refresh: vi.fn(),
  } satisfies SchoolDossierRepository;
  return {
    ...eligibility(),
    aiOperations,
    dossiers,
    essays,
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
    },
    limits: {
      betaAccountCap: 25,
      dailyAiCallLimit: 50,
      monthlyOpenAiBudgetCents: 15_000,
    },
    research: {
      research: vi.fn().mockResolvedValue({
        model: "research-model",
        requestId: "provider-request",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        value: draft,
      }),
    },
    ...overrides,
  };
}

describe("school dossier service", () => {
  it("researches only the registry school and atomically commits a valid result", async () => {
    const deps = dependencies();
    await expect(
      createEssayDossier(
        essayId,
        { idempotencyKey: "research-key-00000001", ipAddress: "203.0.113.10" },
        deps,
        now,
      ),
    ).resolves.toEqual({ dossier, essayRevision: 1 });

    expect(deps.research.research).toHaveBeenCalledWith({ school, userId });
    expect(deps.dossiers.commit).toHaveBeenCalledWith(
      expect.objectContaining({ draft, essayId, operationId, userId }),
    );
    expect(deps.aiOperations.finalize).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.research.research.mock.calls)).not.toContain(
      "Describe a community",
    );
  });

  it("finalizes provider failure without committing or changing the essay", async () => {
    const research = {
      research: vi
        .fn()
        .mockRejectedValue(new AiAdapterError("PROVIDER_TIMEOUT")),
    };
    const deps = dependencies({ research });

    await expect(
      createEssayDossier(
        essayId,
        { idempotencyKey: "research-key-00000002", ipAddress: "203.0.113.10" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(deps.dossiers.commit).not.toHaveBeenCalled();
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        safeErrorCode: "PROVIDER_TIMEOUT",
        status: "UNKNOWN",
      }),
    );
  });

  it("replays the immutable linked dossier without another provider call", async () => {
    const deps = dependencies();
    deps.aiOperations.reserve.mockResolvedValue({
      operationId,
      originalHttpStatus: 201,
      resetAt: new Date("2026-08-04T00:00:00Z"),
      resource: { id: dossierId, type: "SCHOOL_DOSSIER" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });

    await expect(
      createEssayDossier(
        essayId,
        { idempotencyKey: "research-key-00000001", ipAddress: "203.0.113.10" },
        deps,
        now,
      ),
    ).resolves.toEqual({ dossier, essayRevision: 0 });
    expect(deps.research.research).not.toHaveBeenCalled();
    expect(deps.dossiers.findById).toHaveBeenCalledWith(userId, dossierId);
  });

  it("finalizes a commit conflict without binding partial research", async () => {
    const dossiers = {
      commit: vi.fn().mockResolvedValue({ type: "STATE_CONFLICT" }),
      findByEssay: vi.fn(),
      findById: vi.fn(),
      refresh: vi.fn(),
    } satisfies SchoolDossierRepository;
    const deps = dependencies({ dossiers });

    await expect(
      createEssayDossier(
        essayId,
        {
          idempotencyKey: "research-key-00000003",
          ipAddress: "203.0.113.10",
        },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 409,
        safeErrorCode: "STATE_CONFLICT",
        status: "FAILED",
      }),
    );
  });
});

describe("school dossier HTTP contract", () => {
  it("requires idempotency before starting research", async () => {
    const create = vi.fn();
    const refresh = vi.fn();
    const response = await createDossierPostHandler({
      appUrl,
      create,
      refresh,
    })(
      new Request(`${appUrl}api/v1/essays/${essayId}/research`, {
        headers: {
          host: appUrl.host,
          origin: appUrl.origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      essayId,
    );
    expect(response.status).toBe(428);
    expect(create).not.toHaveBeenCalled();
  });

  it("masks malformed dossier identifiers as not found", async () => {
    const get = vi.fn();
    const response = await createDossierGetHandler({ get })("not-an-id");
    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});
