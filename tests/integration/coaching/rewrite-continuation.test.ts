import { describe, expect, it, vi } from "vitest";

import type {
  AiOperationId,
  AiProposalId,
  EssayId,
  SchoolDossierId,
  SchoolDossierSourceId,
  StoryFactId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  ContinuationProposal,
  RewriteProposal,
} from "@/contracts/http/v1/proposals";
import { createDraftTextHash } from "@/lib/security/draft-hash";
import { proposeContinuation } from "@/services/coaching/propose-continuation";
import { proposeRewrite } from "@/services/coaching/propose-rewrite";

const now = new Date("2026-08-03T23:00:00.000Z");
const userId = "e0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "e1000000-0000-4000-8000-000000000001" as EssayId;
const operationId = "e2000000-0000-4000-8000-000000000001" as AiOperationId;
const factId = "e3000000-0000-4000-8000-000000000001" as StoryFactId;
const sourceId =
  "e4000000-0000-4000-8000-000000000001" as SchoolDossierSourceId;
const draftText =
  "I repaired bicycles with neighbors and learned to ask before acting.";

function dependencies() {
  const dossierId = "e5000000-0000-4000-8000-000000000001" as SchoolDossierId;
  const essay = {
    dossierId,
    draftText,
    id: essayId,
    prompt: "How will you contribute?",
    revision: 4,
  };
  const facts = [
    {
      details: ["Hosted repair sessions"],
      id: factId,
      summary: "Bike repair organizer",
    },
  ];
  const dossier = {
    id: dossierId,
    sources: [
      {
        claim: "The college hosts repair events.",
        id: sourceId,
        supportingExcerpt: "Repair events are offered.",
      },
    ],
  };
  const claim = {
    schoolSourceIds: [],
    status: "SUPPORTED" as const,
    storyFactIds: [factId],
    text: "I repaired bicycles with neighbors.",
  };
  const rewriteValue = {
    claims: [claim],
    proposedText: "I fixed bikes alongside neighbors.",
    rationale: "This is more direct.",
  };
  const continuationValue = {
    suggestions: [
      {
        claims: [],
        proposedText: "That habit now shapes how I join a community.",
        rationale: "It connects the lesson to contribution.",
      },
    ],
  };
  const rewriteProposal = {
    ...rewriteValue,
    canAccept: true,
    createdAt: now.toISOString(),
    essayId,
    expiresAt: "2026-08-04T23:00:00.000Z",
    id: "e6000000-0000-4000-8000-000000000001" as AiProposalId,
    instruction: "CLARIFY" as const,
    kind: "REWRITE" as const,
    selection: {
      start: 0,
      end: 34,
      textHash: createDraftTextHash(draftText.slice(0, 34)),
    },
    status: "PENDING" as const,
    targetRevision: 4,
    userId,
  } satisfies RewriteProposal;
  const continuationProposal = {
    ...continuationValue,
    canAccept: true,
    contextHash: createDraftTextHash(draftText),
    createdAt: now.toISOString(),
    cursorOffset: draftText.length,
    essayId,
    expiresAt: "2026-08-04T23:00:00.000Z",
    id: "e7000000-0000-4000-8000-000000000001" as AiProposalId,
    kind: "CONTINUATION" as const,
    status: "PENDING" as const,
    targetRevision: 4,
    userId,
  } satisfies ContinuationProposal;
  return {
    aiOperations: {
      finalize: vi.fn().mockResolvedValue(true),
      release: vi.fn(),
      reserve: vi
        .fn()
        .mockResolvedValue({ operationId, resetAt: now, type: "RESERVED" }),
      start: vi.fn().mockResolvedValue("STARTED"),
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
      monthlyOpenAiBudgetCents: 15_000,
    },
    moderation: {
      check: vi.fn().mockResolvedValue({
        categories: [],
        flagged: false,
        model: "omni-moderation-latest",
        requestId: "mod",
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
          onboardingState: "COMPLETE",
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
        },
      }),
    },
    revisionGenerator: {
      generateContinuation: vi.fn().mockResolvedValue({
        model: "revision-model",
        requestId: "continuation-request",
        usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        value: continuationValue,
      }),
      generateRewrite: vi.fn().mockResolvedValue({
        model: "revision-model",
        requestId: "rewrite-request",
        usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        value: rewriteValue,
      }),
    },
    revisionProposals: {
      commitContinuation: vi
        .fn()
        .mockResolvedValue({ type: "CREATED", value: continuationProposal }),
      commitRewrite: vi
        .fn()
        .mockResolvedValue({ type: "CREATED", value: rewriteProposal }),
      findContinuationById: vi.fn(),
      findRewriteById: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
    vault: { getFactsForAi: vi.fn().mockResolvedValue(facts) },
  };
}

describe("rewrite and continuation proposals", () => {
  it("binds a rewrite to the exact revision, range, and selected text hash", async () => {
    const deps = dependencies();
    const selection = {
      start: 0,
      end: 34,
      textHash: createDraftTextHash(draftText.slice(0, 34)),
    };
    await proposeRewrite(
      essayId,
      { instruction: "CLARIFY", selection },
      { idempotencyKey: "rewrite-key-00000001", ipAddress: "127.0.0.1" },
      deps as never,
      now,
    );
    expect(deps.moderation.check).toHaveBeenNthCalledWith(1, {
      content: [draftText, draftText.slice(0, 34)],
      purpose: "REWRITE",
      userId,
    });
    expect(deps.revisionProposals.commitRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ selection, targetRevision: 4 }),
    );
  });

  it("rejects a stale selection before reservation or generation", async () => {
    const deps = dependencies();
    await expect(
      proposeRewrite(
        essayId,
        {
          instruction: "TIGHTEN",
          selection: {
            start: 0,
            end: 10,
            textHash: createDraftTextHash("different"),
          },
        },
        { idempotencyKey: "rewrite-key-00000002", ipAddress: "127.0.0.1" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
  });

  it("binds continuations to the full current context and moderates generated output", async () => {
    const deps = dependencies();
    const contextHash = createDraftTextHash(draftText);
    await proposeContinuation(
      essayId,
      { contextHash, cursorOffset: draftText.length },
      { idempotencyKey: "continue-key-0000001", ipAddress: "127.0.0.1" },
      deps as never,
      now,
    );
    expect(deps.moderation.check).toHaveBeenCalledTimes(2);
    expect(deps.revisionProposals.commitContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        contextHash,
        cursorOffset: draftText.length,
        targetRevision: 4,
      }),
    );
  });
});
