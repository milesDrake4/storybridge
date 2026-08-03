import { describe, expect, it, vi } from "vitest";

import type { ReferenceDraftGenerationPort } from "@/adapters/openai/reference-draft";
import type {
  AiOperationId,
  AiProposalId,
  EssayAngleId,
  EssayId,
  ProposalClaimId,
  SchoolDossierId,
  SchoolDossierSourceId,
  StoryFactId,
  UserId,
} from "@/contracts/domain/ids";
import {
  CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
  type ReferenceDraftProposal,
} from "@/contracts/http/v1/reference-drafts";
import { generateReferenceDraft } from "@/services/fallback/generate-reference";

const now = new Date("2026-08-04T12:00:00.000Z");
const userId = "d0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "d1000000-0000-4000-8000-000000000001" as EssayId;
const operationId = "d2000000-0000-4000-8000-000000000001" as AiOperationId;
const proposalId = "d3000000-0000-4000-8000-000000000001" as AiProposalId;
const dossierId = "d4000000-0000-4000-8000-000000000001" as SchoolDossierId;
const sourceId =
  "d5000000-0000-4000-8000-000000000001" as SchoolDossierSourceId;
const factId = "d6000000-0000-4000-8000-000000000001" as StoryFactId;
const angleId = "d7000000-0000-4000-8000-000000000001" as EssayAngleId;
const referenceText = "I repaired bicycles with neighbors.";

function dependencies() {
  const essay = {
    createdAt: now.toISOString(),
    dossierId,
    draftText: "",
    id: essayId,
    outline: {
      schemaVersion: "1" as const,
      sections: [1, 2, 3].map((position) => ({
        id: `d8000000-0000-4000-8000-00000000000${position}`,
        purpose: `Purpose ${position}`,
        schoolSourceIds: [sourceId],
        storyFactIds: [factId],
        targetWords: 100,
      })),
    },
    prompt: "Describe how you contribute to a community.",
    revision: 7,
    schoolId: "d9000000-0000-4000-8000-000000000001",
    season: "2026-2027" as const,
    selectedAngleId: angleId,
    status: "DRAFTING" as const,
    updatedAt: now.toISOString(),
    userId,
    wordLimit: 300,
  };
  const fact = {
    category: "EXPERIENCES" as const,
    contentHmac: `v1.${"f".repeat(43)}`,
    createdAt: now.toISOString(),
    details: ["Worked alongside neighbors."],
    id: factId,
    profileId: "da000000-0000-4000-8000-000000000001",
    revision: 1,
    sourceMessageIds: ["db000000-0000-4000-8000-000000000001"],
    summary: "Repaired bicycles with neighbors.",
    suppressedAt: null,
    updatedAt: now.toISOString(),
    userId,
    verificationStatus: "VERIFIED" as const,
    verifiedAt: now.toISOString(),
  };
  const proposal: ReferenceDraftProposal = {
    acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
    canAccept: false,
    claims: [
      {
        contentHmac: `v1.${"c".repeat(43)}`,
        end: Array.from(referenceText).length,
        id: "dc000000-0000-4000-8000-000000000001" as ProposalClaimId,
        schoolSourceIds: [],
        start: 0,
        status: "SUPPORTED",
        storyFactIds: [factId],
        text: referenceText,
      },
    ],
    createdAt: now.toISOString(),
    essayId,
    expiresAt: "2028-02-04T12:00:00.000Z",
    id: proposalId,
    kind: "REFERENCE_DRAFT",
    rationale: "A reference organized from the confirmed outline.",
    referenceText,
    status: "PENDING",
    targetRevision: 7,
    userId,
  };
  const generation = {
    model: "gpt-test",
    requestId: "response-reference-1",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    value: {
      claims: [
        {
          end: Array.from(referenceText).length,
          schoolSourceIds: [],
          start: 0,
          storyFactIds: [factId],
          text: referenceText,
        },
      ],
      rationale: proposal.rationale,
      referenceText,
    },
  };
  return {
    aiOperations: {
      finalize: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      reserve: vi.fn().mockResolvedValue({
        operationId,
        resetAt: new Date("2026-08-05T00:00:00.000Z"),
        type: "RESERVED",
      }),
      start: vi.fn().mockResolvedValue("STARTED"),
    },
    angles: {
      list: vi.fn().mockResolvedValue([
        {
          dossierId,
          essayId,
          id: angleId,
          schoolSourceIds: [sourceId],
          storyFactIds: [factId],
          userId,
        },
      ]),
    },
    dossiers: {
      findByEssay: vi.fn().mockResolvedValue({
        createdAt: now.toISOString(),
        essayId,
        id: dossierId,
        schemaVersion: "1",
        schoolId: essay.schoolId,
        sources: [
          {
            category: "COMMUNITY",
            claim: "The school supports community partnerships.",
            id: sourceId,
            normalizedUrl: "https://example.edu/community",
            retrievedAt: now.toISOString(),
            supportingExcerpt: "Community partnerships are supported.",
            title: "Community",
          },
        ],
        summary: "School evidence.",
        updatedAt: now.toISOString(),
        userId,
      }),
    },
    essays: { get: vi.fn().mockResolvedValue({ essay, school: {} }) },
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
    moderation: {
      check: vi.fn().mockResolvedValue({ flagged: false }),
    },
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
        },
      }),
    },
    referenceDraftGenerator: {
      generate: vi.fn().mockResolvedValue(generation),
    } satisfies ReferenceDraftGenerationPort,
    referenceDrafts: {
      commit: vi.fn().mockResolvedValue({ type: "CREATED", value: proposal }),
      findById: vi.fn().mockResolvedValue(proposal),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
    vault: {
      getCurrent: vi.fn().mockResolvedValue({
        facts: [],
        profile: {
          id: "da000000-0000-4000-8000-000000000001",
          voiceProfile: {
            sentenceStyle: "Direct sentences.",
            toneTraits: ["reflective"],
            vocabulary: "Plain language.",
          },
        },
      }),
      getFactsForAi: vi.fn().mockResolvedValue([fact]),
    },
  };
}

const input = {
  acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
};
const request = {
  idempotencyKey: "reference-key-0001",
  ipAddress: "127.0.0.1",
};

describe("reference draft generation", () => {
  it("blocks missing fallback prerequisites before quota or provider use", async () => {
    const deps = dependencies();
    const workspace = await deps.essays.get();
    deps.essays.get.mockResolvedValue({
      ...workspace,
      essay: { ...workspace.essay, outline: null },
    });

    await expect(
      generateReferenceDraft(essayId, input, request, deps as never, now),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
    expect(deps.moderation.check).not.toHaveBeenCalled();
    expect(deps.referenceDraftGenerator.generate).not.toHaveBeenCalled();
  });

  it("requires the current explicit acknowledgment before reserving", async () => {
    const deps = dependencies();
    await expect(
      generateReferenceDraft(
        essayId,
        { acknowledgmentVersion: "old-version" } as never,
        request,
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
  });

  it("persists an evidence-bound, never-accept-capable reference proposal", async () => {
    const deps = dependencies();
    const result = await generateReferenceDraft(
      essayId,
      input,
      request,
      deps as never,
      now,
    );

    expect(result).toMatchObject({ canAccept: false, kind: "REFERENCE_DRAFT" });
    expect(deps.aiOperations.start).toHaveBeenCalledWith(operationId, now);
    expect(deps.referenceDrafts.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
        claims: [
          expect.objectContaining({
            contentHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
            storyFactIds: [factId],
          }),
        ],
        essayId,
        operationId,
        targetRevision: 7,
        userId,
      }),
    );
  });

  it("rejects provider claims that do not map to allowed evidence", async () => {
    const deps = dependencies();
    const generation = await deps.referenceDraftGenerator.generate({} as never);
    deps.referenceDraftGenerator.generate.mockResolvedValue({
      ...generation,
      value: {
        ...generation.value,
        claims: [
          {
            ...generation.value.claims[0],
            storyFactIds: [
              "dd000000-0000-4000-8000-000000000001" as StoryFactId,
            ],
          },
        ],
      },
    });

    await expect(
      generateReferenceDraft(essayId, input, request, deps as never, now),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(deps.referenceDrafts.commit).not.toHaveBeenCalled();
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  it("allows only one concurrent provider start for an essay", async () => {
    const deps = dependencies();
    deps.aiOperations.start.mockResolvedValue("FALLBACK_LIMIT_REACHED");

    await expect(
      generateReferenceDraft(essayId, input, request, deps as never, now),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(deps.referenceDraftGenerator.generate).not.toHaveBeenCalled();
  });
});
