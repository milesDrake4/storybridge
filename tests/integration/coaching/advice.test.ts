import { describe, expect, it, vi } from "vitest";

import type {
  AiOperationId,
  AiProposalId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";
import type { AdviceProposal } from "@/contracts/http/v1/proposals";
import { proposeAdvice } from "@/services/coaching/propose-advice";

const now = new Date("2026-08-03T22:00:00.000Z");
const userId = "d0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "d1000000-0000-4000-8000-000000000001" as EssayId;
const operationId = "d2000000-0000-4000-8000-000000000001" as AiOperationId;
const proposal: AdviceProposal = {
  canAccept: false,
  createdAt: now.toISOString(),
  essayId,
  expiresAt: "2026-08-04T22:00:00.000Z",
  guidance: ["Clarify the choice you made and its consequence."],
  headline: "Center your decision",
  id: "d3000000-0000-4000-8000-000000000001" as AiProposalId,
  kind: "ADVICE",
  rationale: "The current draft centers the event rather than your agency.",
  status: "PENDING",
  targetRevision: 7,
  userId,
};

function dependencies(flagged = false) {
  const essay = {
    createdAt: now.toISOString(),
    dossierId: "d4000000-0000-4000-8000-000000000001" as SchoolDossierId,
    draftText: "I organized a repair workshop with my neighbors.",
    id: essayId,
    outline: {
      schemaVersion: "1" as const,
      sections: [],
    },
    prompt: "Describe a community that shaped how you contribute today.",
    revision: 7,
    schoolId: "d5000000-0000-4000-8000-000000000001",
    season: "2026-2027" as const,
    selectedAngleId: "d6000000-0000-4000-8000-000000000001",
    status: "DRAFTING" as const,
    updatedAt: now.toISOString(),
    userId,
    wordLimit: 300,
  };
  const facts = [{ id: "d7000000-0000-4000-8000-000000000001" }];
  const dossier = {
    id: essay.dossierId,
    sources: [{ id: "d8000000-0000-4000-8000-000000000001" }],
  };
  return {
    adviceProposals: {
      commit: vi.fn().mockResolvedValue({ type: "CREATED", value: proposal }),
      findById: vi.fn(),
    },
    aiOperations: {
      finalize: vi.fn().mockResolvedValue(true),
      release: vi.fn(),
      reserve: vi.fn().mockResolvedValue({
        operationId,
        resetAt: new Date("2026-08-04T00:00:00Z"),
        type: "RESERVED",
      }),
      start: vi.fn().mockResolvedValue("STARTED"),
    },
    coachGenerator: {
      generate: vi.fn().mockResolvedValue({
        model: "coach-model",
        requestId: "coach-request",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        value: {
          guidance: proposal.guidance,
          headline: proposal.headline,
          rationale: proposal.rationale,
        },
      }),
    },
    dossiers: { findByEssay: vi.fn().mockResolvedValue(dossier) },
    essays: { get: vi.fn().mockResolvedValue({ essay, school: {} }) },
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
    },
    limits: {
      betaAccountCap: 25,
      dailyAiCallLimit: 50,
      monthlyOpenAiBudgetCents: 15000,
    },
    moderation: {
      check: vi.fn().mockResolvedValue({
        categories: flagged ? ["violence"] : [],
        flagged,
        model: "omni-moderation-latest",
        requestId: "moderation-request",
        scores: {},
      }),
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
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
    vault: { getFactsForAi: vi.fn().mockResolvedValue(facts) },
  } as unknown as Parameters<typeof proposeAdvice>[3];
}

describe("advice proposal generation", () => {
  it("moderates private input and commits immutable advice at the exact revision", async () => {
    const deps = dependencies();
    await expect(
      proposeAdvice(
        essayId,
        { question: "How can I make my role clearer?" },
        { idempotencyKey: "advice-key-00000001", ipAddress: "127.0.0.1" },
        deps,
        now,
      ),
    ).resolves.toEqual(proposal);
    expect(deps.moderation.check).toHaveBeenCalledWith({
      content: [
        "How can I make my role clearer?",
        "I organized a repair workshop with my neighbors.",
      ],
      purpose: "COACHING",
      userId,
    });
    expect(deps.adviceProposals.commit).toHaveBeenCalledWith(
      expect.objectContaining({ essayId, targetRevision: 7, userId }),
    );
  });

  it("refuses flagged input before generation or persistence", async () => {
    const deps = dependencies(true);
    await expect(
      proposeAdvice(
        essayId,
        { question: "Flagged synthetic question" },
        { idempotencyKey: "advice-key-00000002", ipAddress: "127.0.0.1" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.coachGenerator.generate).not.toHaveBeenCalled();
    expect(deps.adviceProposals.commit).not.toHaveBeenCalled();
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REFUSED" }),
    );
  });
});
