import { describe, expect, it, vi } from "vitest";

import type {
  AiProposalId,
  EssayId,
  StoryFactId,
  UserId,
} from "@/contracts/domain/ids";
import type { RewriteProposal } from "@/contracts/http/v1/proposals";
import { createDraftTextHash } from "@/lib/security/draft-hash";
import { acceptProposal } from "@/services/coaching/accept-proposal";

const now = new Date("2026-08-04T00:00:00.000Z");
const userId = "f1000000-0000-4000-8000-000000000001" as UserId;
const essayId = "f2000000-0000-4000-8000-000000000001" as EssayId;
const proposalId = "f3000000-0000-4000-8000-000000000001" as AiProposalId;
const factId = "f4000000-0000-4000-8000-000000000001" as StoryFactId;
const draftText = "I repaired bicycles with neighbors.";
const selectionText = "repaired bicycles";
const start = draftText.indexOf(selectionText);

function dependencies(overrides?: { proposal?: RewriteProposal | null }) {
  const essay = {
    createdAt: now.toISOString(),
    dossierId: "f5000000-0000-4000-8000-000000000001",
    draftText,
    id: essayId,
    outline: { schemaVersion: "1", sections: [] },
    prompt: "Describe how you will contribute to this campus community.",
    revision: 7,
    schoolId: "f6000000-0000-4000-8000-000000000001",
    season: "2026-2027",
    selectedAngleId: null,
    status: "DRAFTING",
    updatedAt: now.toISOString(),
    userId,
    wordLimit: 300,
  };
  const proposal: RewriteProposal = {
    canAccept: true,
    claims: [
      {
        schoolSourceIds: [],
        status: "SUPPORTED",
        storyFactIds: [factId],
        text: "I repaired bicycles.",
      },
    ],
    createdAt: now.toISOString(),
    essayId,
    expiresAt: "2026-08-05T00:00:00.000Z",
    id: proposalId,
    instruction: "CLARIFY",
    kind: "REWRITE",
    proposedText: "fixed bikes",
    rationale: "This is more direct.",
    selection: {
      end: start + selectionText.length,
      start,
      textHash: createDraftTextHash(selectionText),
    },
    status: "PENDING",
    targetRevision: 7,
    userId,
  };
  const acceptedEssay = {
    ...essay,
    draftText: "I fixed bikes with neighbors.",
    revision: 8,
  };
  return {
    acceptance: {
      accept: vi
        .fn()
        .mockResolvedValue({ type: "ACCEPTED", value: acceptedEssay }),
      replay: vi.fn().mockResolvedValue(null),
    },
    essays: { get: vi.fn().mockResolvedValue({ essay, school: {} }) },
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
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
    revisionProposals: {
      findContinuationById: vi.fn().mockResolvedValue(null),
      findRewriteById: vi
        .fn()
        .mockResolvedValue(
          overrides?.proposal === undefined ? proposal : overrides.proposal,
        ),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

describe("proposal acceptance", () => {
  it("computes the exact next draft and delegates one atomic acceptance", async () => {
    const deps = dependencies();
    await expect(
      acceptProposal(
        essayId,
        proposalId,
        7,
        { idempotencyKey: "accept-key-00000001" },
        deps as never,
        now,
      ),
    ).resolves.toMatchObject({
      draftText: "I fixed bikes with neighbors.",
      revision: 8,
    });
    expect(deps.acceptance.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        essayId,
        expectedCurrentDraft: draftText,
        expectedRevision: 7,
        nextDraft: "I fixed bikes with neighbors.",
        proposalId,
        userId,
      }),
    );
  });

  it("rejects a changed selection without mutating the essay", async () => {
    const deps = dependencies();
    const proposal = await deps.revisionProposals.findRewriteById();
    if (!proposal) throw new Error("fixture proposal missing");
    deps.revisionProposals.findRewriteById.mockResolvedValue({
      ...proposal,
      selection: {
        ...proposal.selection,
        textHash: createDraftTextHash("stale selection"),
      },
    });
    await expect(
      acceptProposal(
        essayId,
        proposalId,
        7,
        { idempotencyKey: "accept-key-00000002" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_ACCEPTABLE" });
    expect(deps.acceptance.accept).not.toHaveBeenCalled();
  });

  it("rejects non-accept-capable proposal kinds", async () => {
    const deps = dependencies({ proposal: null });
    await expect(
      acceptProposal(
        essayId,
        proposalId,
        7,
        { idempotencyKey: "accept-key-00000003" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_ACCEPTABLE" });
    expect(deps.acceptance.accept).not.toHaveBeenCalled();
  });

  it("replays the original acceptance before revalidating changed state", async () => {
    const deps = dependencies();
    const workspace = await deps.essays.get();
    deps.essays.get.mockClear();
    deps.acceptance.replay.mockResolvedValue({
      type: "REPLAY",
      value: {
        ...workspace.essay,
        draftText: "I fixed bikes with neighbors.",
        revision: 8,
      },
    });
    const result = await acceptProposal(
      essayId,
      proposalId,
      7,
      { idempotencyKey: "accept-key-00000004" },
      deps as never,
      now,
    );
    expect(result).toMatchObject({ revision: 8 });
    expect(deps.essays.get).not.toHaveBeenCalled();
    expect(deps.acceptance.accept).not.toHaveBeenCalled();
  });
});
