import { describe, expect, it, vi } from "vitest";

import { createDossierPostHandler } from "@/app/api/v1/essays/research-handler";
import type {
  AiOperationId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import { SchoolDossierError } from "@/services/research/create-dossier";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
import { refreshEssayDossier } from "@/services/research/refresh-dossier";

const appUrl = new URL("https://storybridge.test");
const essayId = "d1000000-0000-4000-8000-000000000001" as EssayId;
const dossier = {
  createdAt: "2026-08-03T19:00:00.000Z",
  essayId,
  id: "d2000000-0000-4000-8000-000000000001" as SchoolDossierId,
  schemaVersion: "1",
  schoolId: "d3000000-0000-4000-8000-000000000001",
  sources: [
    {
      category: "PROGRAMS",
      claim: "The program supports cross-disciplinary study.",
      id: "d4000000-0000-4000-8000-000000000001",
      normalizedUrl: "https://umich.edu/programs",
      retrievedAt: "2026-08-03T18:55:00.000Z",
      supportingExcerpt: "Students can work across academic disciplines.",
      title: "Programs",
    },
  ],
  summary: "Refreshed, cited school evidence.",
  updatedAt: "2026-08-03T19:00:00.000Z",
  userId: "d0000000-0000-4000-8000-000000000001" as UserId,
} as SchoolDossier;

const school = {
  canonicalName: "University of Michigan",
  id: dossier.schoolId,
  officialDomain: "umich.edu",
};
const operationId = "d5000000-0000-4000-8000-000000000001" as AiOperationId;

function request(body: unknown, ifMatch?: string) {
  return new Request(`${appUrl}api/v1/essays/${essayId}/research`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: appUrl.host,
      "idempotency-key": "refresh-research-key-0001",
      ...(ifMatch ? { "if-match": ifMatch } : {}),
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

function handler(refresh = vi.fn()) {
  const create = vi.fn();
  return {
    create,
    refresh,
    run: createDossierPostHandler({ appUrl, create, refresh }),
  };
}

describe("research refresh HTTP contract", () => {
  it("requires explicit dependent-work invalidation", async () => {
    const { refresh, run } = handler();
    const response = await run(request({ refresh: true }), essayId);

    expect(response.status).toBe(422);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("requires the current essay ETag before starting refresh", async () => {
    const { refresh, run } = handler();
    const response = await run(
      request({ invalidateDependentWork: true, refresh: true }),
      essayId,
    );

    expect(response.status).toBe(428);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("passes the expected revision and emits the atomically advanced ETag", async () => {
    const refresh = vi.fn().mockResolvedValue({ dossier, essayRevision: 8 });
    const { create, run } = handler(refresh);
    const response = await run(
      request(
        { invalidateDependentWork: true, refresh: true },
        `"essay:${essayId}:r7"`,
      ),
      essayId,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe(`"essay:${essayId}:r8"`);
    expect(refresh).toHaveBeenCalledWith(
      essayId,
      7,
      expect.objectContaining({
        idempotencyKey: "refresh-research-key-0001",
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("maps a concurrent revision change to 412", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValue(new SchoolDossierError("REVISION_MISMATCH"));
    const { run } = handler(refresh);
    const response = await run(
      request(
        { invalidateDependentWork: true, refresh: true },
        `"essay:${essayId}:r7"`,
      ),
      essayId,
    );

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REVISION_MISMATCH" },
    });
  });
});

describe("research refresh service", () => {
  it("finalizes a stale provider result as 412 without a partial commit", async () => {
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
          createdAt: dossier.createdAt,
          dossierId: dossier.id,
          draftText: "",
          id: essayId,
          outline: null,
          prompt: "Describe a community that has shaped your perspective.",
          revision: 7,
          schoolId: school.id,
          selectedAngleId: null,
          season: "2026-2027",
          status: "STRATEGY",
          updatedAt: dossier.updatedAt,
          userId: dossier.userId,
          wordLimit: 300,
        },
        school,
      }),
      list: vi.fn(),
      updateOutline: vi.fn(),
    } as EssayWorkspaceRepository;
    const dossiers = {
      commit: vi.fn(),
      findByEssay: vi.fn(),
      findById: vi.fn(),
      refresh: vi.fn().mockResolvedValue({ type: "REVISION_MISMATCH" }),
    } satisfies SchoolDossierRepository;
    const research = {
      research: vi.fn().mockResolvedValue({
        model: "research-model",
        requestId: "refresh-provider",
        usage: { inputTokens: 110, outputTokens: 55, totalTokens: 165 },
        value: {
          schemaVersion: "1" as const,
          sources: dossier.sources.map((source) => ({
            category: source.category,
            claim: source.claim,
            normalizedUrl: source.normalizedUrl,
            retrievedAt: source.retrievedAt,
            supportingExcerpt: source.supportingExcerpt,
            title: source.title,
          })),
          summary: dossier.summary,
        },
      }),
    };
    const now = new Date("2026-08-03T19:00:00.000Z");

    await expect(
      refreshEssayDossier(
        essayId,
        7,
        {
          idempotencyKey: "refresh-service-key-0001",
          ipAddress: "203.0.113.1",
        },
        {
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
          profiles: {
            getEligibility: vi.fn().mockResolvedValue({
              hasAcceptedInvitation: true,
              profile: {
                ageConfirmedAt: now.toISOString(),
                birthYear: 2000,
                consentedAt: now.toISOString(),
                createdAt: now.toISOString(),
                displayName: null,
                onboardingState: "COMPLETE",
                privacyVersion: "privacy-2026-08-02",
                responsibleUseVersion: "responsible-use-2026-08-02",
                termsVersion: "terms-2026-08-02",
                updatedAt: now.toISOString(),
                userId: dossier.userId,
              },
            }),
            recordConsent: vi.fn(),
          },
          research,
          session: {
            requireUserId: vi.fn().mockResolvedValue(dossier.userId),
          },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });

    expect(dossiers.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ essayId, expectedRevision: 7 }),
    );
    expect(dossiers.commit).not.toHaveBeenCalled();
    expect(aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 412,
        safeErrorCode: "REVISION_MISMATCH",
        status: "FAILED",
      }),
    );
    expect(JSON.stringify(research.research.mock.calls)).not.toContain(
      "Describe a community",
    );
  });
});
