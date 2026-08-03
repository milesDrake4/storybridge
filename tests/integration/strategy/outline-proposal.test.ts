import { describe, expect, it, vi } from "vitest";

import type { EssayAngle } from "@/contracts/domain/essay-angle";
import type {
  AiOperationId,
  AiProposalId,
  EssayAngleId,
  EssayId,
  OutlineSectionId,
  SchoolDossierId,
  SchoolDossierSourceId,
  StoryFactId,
  UserId,
} from "@/contracts/domain/ids";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";
import type { StoryFact } from "@/contracts/domain/story-vault";
import type {
  OutlineProposal,
  OutlineProposalDraft,
} from "@/contracts/http/v1/outlines";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import type { OutlineProposalRepository } from "@/repositories/outline-proposal-repository";
import type { SchoolDossierRepository } from "@/repositories/school-dossier-repository";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import { proposeEssayOutline } from "@/services/strategy/propose-outline";

const now = new Date("2026-08-03T22:00:00.000Z");
const userId = "d0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "d1000000-0000-4000-8000-000000000001" as EssayId;
const dossierId = "d2000000-0000-4000-8000-000000000001" as SchoolDossierId;
const angleId = "d3000000-0000-4000-8000-000000000001" as EssayAngleId;
const factId = "d4000000-0000-4000-8000-000000000001" as StoryFactId;
const sourceId =
  "d5000000-0000-4000-8000-000000000001" as SchoolDossierSourceId;
const operationId = "d6000000-0000-4000-8000-000000000001" as AiOperationId;
const proposalId = "d7000000-0000-4000-8000-000000000001" as AiProposalId;

const angle = {
  createdAt: now.toISOString(),
  dossierId,
  essayId,
  id: angleId,
  position: 1,
  promptFit: "Connects service to contribution.",
  risk: "Stay specific.",
  schoolSourceIds: [sourceId],
  selectedAt: now.toISOString(),
  storyFactIds: [factId],
  thesis: "Repairing objects built trust with neighbors.",
  title: "Repair as relationship",
  updatedAt: now.toISOString(),
  userId,
} as EssayAngle;
const dossier = {
  createdAt: now.toISOString(),
  essayId,
  id: dossierId,
  schemaVersion: "1",
  schoolId: "d8000000-0000-4000-8000-000000000001",
  sources: [
    {
      category: "COMMUNITY",
      claim: "Students collaborate through community projects.",
      id: sourceId,
      normalizedUrl: "https://umich.edu/community",
      retrievedAt: now.toISOString(),
      supportingExcerpt: "Projects connect students across fields.",
      title: "Community",
    },
  ],
  summary: "Community evidence.",
  updatedAt: now.toISOString(),
  userId,
} as SchoolDossier;
const fact = {
  category: "EXPERIENCES",
  contentHmac: `v1.${"A".repeat(43)}`,
  createdAt: now.toISOString(),
  details: ["Organized a repair workshop."],
  id: factId,
  profileId: "d9000000-0000-4000-8000-000000000001",
  revision: 1,
  sourceMessageIds: ["da000000-0000-4000-8000-000000000001"],
  summary: "Built community through a repair workshop.",
  suppressedAt: null,
  updatedAt: now.toISOString(),
  userId,
  verificationStatus: "VERIFIED",
  verifiedAt: now.toISOString(),
} as StoryFact;
const draft = {
  outline: {
    schemaVersion: "1",
    sections: [1, 2, 3, 4].map((index) => ({
      id: `db000000-0000-4000-8000-00000000000${index}` as OutlineSectionId,
      purpose: `Evidence-linked section purpose ${index}.`,
      schoolSourceIds: [sourceId],
      storyFactIds: [factId],
      targetWords: 75,
    })),
  },
  rationale:
    "Moves from a concrete experience to a specific school connection.",
} as OutlineProposalDraft;
const proposal = {
  ...draft,
  canAccept: false,
  createdAt: now.toISOString(),
  essayId,
  expiresAt: "2026-09-02T22:00:00.000Z",
  id: proposalId,
  kind: "OUTLINE",
  selectedAngleId: angleId,
  status: "PENDING",
  targetRevision: 2,
  userId,
} as OutlineProposal;

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
    commit: vi.fn(),
    list: vi.fn().mockResolvedValue([angle]),
    select: vi.fn(),
    update: vi.fn(),
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
        revision: 2,
        schoolId: dossier.schoolId,
        season: "2026-2027",
        selectedAngleId: angleId,
        status: "OUTLINING",
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
  const outlineProposals = {
    commit: vi.fn().mockResolvedValue({ type: "CREATED", value: proposal }),
    findById: vi.fn().mockResolvedValue(proposal),
  } satisfies OutlineProposalRepository;
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
  const dossiers = {
    commit: vi.fn(),
    findByEssay: vi.fn().mockResolvedValue(dossier),
    findById: vi.fn(),
    refresh: vi.fn(),
  } satisfies SchoolDossierRepository;
  return {
    aiOperations,
    angles,
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
    outlineGenerator: {
      generate: vi.fn().mockResolvedValue({
        model: "outline-model",
        requestId: "outline-request",
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        value: draft,
      }),
    },
    outlineProposals,
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

describe("immutable outline proposal service", () => {
  it("persists an evidence-linked proposal without mutating the editable outline", async () => {
    const deps = dependencies();
    await expect(
      proposeEssayOutline(
        essayId,
        { idempotencyKey: "outline-key-00000001", ipAddress: "203.0.113.3" },
        deps,
        now,
      ),
    ).resolves.toEqual(proposal);
    expect(deps.outlineProposals.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        angleId,
        dossierId,
        draft,
        targetRevision: 2,
      }),
    );
    expect(deps.essays.get).toHaveBeenCalledTimes(1);
    expect(deps.aiOperations.finalize).not.toHaveBeenCalled();
  });

  it("rejects word allocation outside ten percent before persistence", async () => {
    const invalid = {
      ...draft,
      outline: {
        ...draft.outline,
        sections: draft.outline.sections.map((section) => ({
          ...section,
          targetWords: 50,
        })),
      },
    };
    const deps = dependencies({
      outlineGenerator: {
        generate: vi.fn().mockResolvedValue({
          model: "outline-model",
          requestId: "outline-request",
          usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
          value: invalid,
        }),
      },
    });
    await expect(
      proposeEssayOutline(
        essayId,
        { idempotencyKey: "outline-key-00000002", ipAddress: "203.0.113.3" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(deps.outlineProposals.commit).not.toHaveBeenCalled();
  });

  it("replays the same immutable proposal without a second provider call", async () => {
    const deps = dependencies();
    deps.aiOperations.reserve.mockResolvedValue({
      operationId,
      originalHttpStatus: 201,
      resetAt: new Date("2026-08-04T00:00:00Z"),
      resource: { id: proposalId, type: "OUTLINE_PROPOSAL" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });
    await expect(
      proposeEssayOutline(
        essayId,
        { idempotencyKey: "outline-key-00000001", ipAddress: "203.0.113.3" },
        deps,
        now,
      ),
    ).resolves.toEqual(proposal);
    expect(deps.outlineGenerator.generate).not.toHaveBeenCalled();
    expect(deps.outlineProposals.findById).toHaveBeenCalledWith(
      userId,
      proposalId,
    );
  });
});
