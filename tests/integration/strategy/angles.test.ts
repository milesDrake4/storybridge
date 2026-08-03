import { describe, expect, it, vi } from "vitest";

import { createAnglesPostHandler } from "@/app/api/v1/essays/angles-handler";
import type {
  EssayAngle,
  EssayAngleDraft,
} from "@/contracts/domain/essay-angle";
import type {
  AiOperationId,
  EssayAngleId,
  EssayId,
  SchoolDossierId,
  SchoolDossierSourceId,
  StoryFactId,
  StoryProfileId,
  UserId,
} from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import type { StoryFact } from "@/contracts/domain/story-vault";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import { generateEssayAngles } from "@/services/strategy/generate-angles";

const now = new Date("2026-08-03T20:00:00.000Z");
const appUrl = new URL("https://storybridge.test");
const userId = "e0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "e1000000-0000-4000-8000-000000000001" as EssayId;
const dossierId = "e2000000-0000-4000-8000-000000000001" as SchoolDossierId;
const sourceId =
  "e3000000-0000-4000-8000-000000000001" as SchoolDossierSourceId;
const factId = "e4000000-0000-4000-8000-000000000001" as StoryFactId;
const operationId = "e5000000-0000-4000-8000-000000000001" as AiOperationId;

const dossier = {
  createdAt: now.toISOString(),
  essayId,
  id: dossierId,
  schemaVersion: "1",
  schoolId: "e6000000-0000-4000-8000-000000000001",
  sources: [
    {
      category: "COMMUNITY",
      claim: "Students collaborate through community projects.",
      id: sourceId,
      normalizedUrl: "https://umich.edu/community",
      retrievedAt: now.toISOString(),
      supportingExcerpt: "Community projects connect students across fields.",
      title: "Community projects",
    },
  ],
  summary: "Cited community evidence.",
  updatedAt: now.toISOString(),
  userId,
} as SchoolDossier;

const fact = {
  category: "EXPERIENCES",
  contentHmac: `v1.${"A".repeat(43)}`,
  createdAt: now.toISOString(),
  details: ["Organized a neighborhood repair workshop."],
  id: factId,
  profileId: "e7000000-0000-4000-8000-000000000001" as StoryProfileId,
  revision: 1,
  sourceMessageIds: ["e8000000-0000-4000-8000-000000000001"],
  summary: "Built community through a repair workshop.",
  suppressedAt: null,
  updatedAt: now.toISOString(),
  userId,
  verificationStatus: "VERIFIED",
  verifiedAt: now.toISOString(),
} as StoryFact;

const drafts = [
  {
    promptFit: "Connects a concrete act of service to future collaboration.",
    risk: "Avoid making one workshop sound larger than it was.",
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    thesis:
      "Repairing objects taught me to build trust by working beside people.",
    title: "Repair as relationship",
  },
  {
    promptFit: "Shows curiosity translated into shared community value.",
    risk: "Keep the focus on people rather than technical detail.",
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    thesis:
      "A technical interest became meaningful when I made it accessible to neighbors.",
    title: "Curiosity made useful",
  },
  {
    promptFit: "Demonstrates how the student listens and adapts in community.",
    risk: "Include one specific moment of changed perspective.",
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    thesis:
      "The workshop changed my definition of leadership from directing to listening.",
    title: "Leadership by listening",
  },
] as [EssayAngleDraft, EssayAngleDraft, EssayAngleDraft];

const persisted = drafts.map((angle, index) => ({
  ...angle,
  createdAt: now.toISOString(),
  dossierId,
  essayId,
  id: `e9000000-0000-4000-8000-00000000000${index + 1}` as EssayAngleId,
  position: index + 1,
  selectedAt: null,
  updatedAt: now.toISOString(),
  userId,
})) as [EssayAngle, EssayAngle, EssayAngle];

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
  const angles = {
    commit: vi.fn().mockResolvedValue({ type: "CREATED", value: persisted }),
    list: vi.fn().mockResolvedValue(persisted),
  } satisfies EssayAngleRepository;
  const essays = {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn().mockResolvedValue({
      essay: {
        createdAt: now.toISOString(),
        dossierId,
        id: essayId,
        prompt:
          "How will your experiences help you contribute to our community?",
        revision: 1,
        schoolId: dossier.schoolId,
        season: "2026-2027",
        status: "STRATEGY",
        updatedAt: now.toISOString(),
        userId,
        wordLimit: 300,
      },
      school: {
        canonicalName: "University of Michigan",
        id: dossier.schoolId,
        officialDomain: "umich.edu",
      },
    }),
    list: vi.fn(),
  } as EssayWorkspaceRepository;
  const dossiers = {
    commit: vi.fn(),
    findByEssay: vi.fn().mockResolvedValue(dossier),
    findById: vi.fn(),
    refresh: vi.fn(),
  } satisfies SchoolDossierRepository;
  const vault = {
    create: vi.fn(),
    deleteFact: vi.fn(),
    findById: vi.fn(),
    findBySession: vi.fn(),
    getCurrent: vi.fn(),
    getFactsForAi: vi.fn().mockResolvedValue([fact]),
    getInterview: vi.fn(),
    suppressFact: vi.fn(),
    updateFact: vi.fn(),
    updateProfile: vi.fn(),
    verifyFact: vi.fn(),
  } satisfies StoryVaultRepository;
  return {
    aiOperations,
    angles,
    dossiers,
    essays,
    generator: {
      generate: vi.fn().mockResolvedValue({
        model: "angle-model",
        requestId: "angle-request",
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        value: { angles: drafts, followUpQuestion: null, status: "READY" },
      }),
    },
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
          userId,
        },
      }),
      recordConsent: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
    vault,
    ...overrides,
  };
}

describe("evidence-linked angle generation", () => {
  it("commits exactly three angles linked only to verified current evidence", async () => {
    const deps = dependencies();
    await expect(
      generateEssayAngles(
        essayId,
        { regenerate: false },
        { idempotencyKey: "angle-key-00000001", ipAddress: "203.0.113.2" },
        deps,
        now,
      ),
    ).resolves.toEqual(persisted);

    expect(deps.generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ dossier, facts: [fact] }),
    );
    expect(deps.angles.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        angles: drafts,
        dossierId,
        regenerate: false,
        userId,
      }),
    );
    expect(deps.aiOperations.finalize).not.toHaveBeenCalled();
  });

  it("rejects fabricated evidence IDs before persistence", async () => {
    const fabricated = "ea000000-0000-4000-8000-000000000001" as StoryFactId;
    const deps = dependencies({
      generator: {
        generate: vi.fn().mockResolvedValue({
          model: "angle-model",
          requestId: "angle-request",
          usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
          value: {
            angles: [
              { ...drafts[0], storyFactIds: [fabricated] },
              drafts[1],
              drafts[2],
            ],
            followUpQuestion: null,
            status: "READY",
          },
        }),
      },
    });

    await expect(
      generateEssayAngles(
        essayId,
        { regenerate: false },
        { idempotencyKey: "angle-key-00000002", ipAddress: "203.0.113.2" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(deps.angles.commit).not.toHaveBeenCalled();
  });

  it("returns one targeted follow-up before spending quota when no verified facts exist", async () => {
    const vault = dependencies().vault;
    vault.getFactsForAi.mockResolvedValue([]);
    const deps = dependencies({ vault });

    await expect(
      generateEssayAngles(
        essayId,
        { regenerate: false },
        { idempotencyKey: "angle-key-00000003", ipAddress: "203.0.113.2" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_EVIDENCE",
      followUpQuestion: expect.stringMatching(/specific experience/i),
    });
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
  });
});

describe("angle endpoint", () => {
  it("requires idempotency and a strict regeneration body", async () => {
    const generate = vi.fn();
    const handler = createAnglesPostHandler({ appUrl, generate });
    const response = await handler(
      new Request(`${appUrl}api/v1/essays/${essayId}/angles`, {
        body: JSON.stringify({ regenerate: false }),
        headers: {
          "content-type": "application/json",
          host: appUrl.host,
          origin: appUrl.origin,
        },
        method: "POST",
      }),
      essayId,
    );
    expect(response.status).toBe(428);
    expect(generate).not.toHaveBeenCalled();
  });
});
