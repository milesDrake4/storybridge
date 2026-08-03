import { describe, expect, it } from "vitest";

import type { AiProposalId, EssayId, UserId } from "@/contracts/domain/ids";
import type { RewriteProposal } from "@/contracts/http/v1/proposals";
import {
  applyRewriteProposal,
  codePointOffset,
  sliceByCodePoints,
} from "@/lib/essay/apply-proposal";
import { createDraftTextHash } from "@/lib/security/draft-hash";

describe("proposal application", () => {
  it("uses Unicode code-point offsets consistently for browser and database parity", () => {
    const draft = "I repair 🚲 bikes.";
    const utf16Start = draft.indexOf("🚲");
    const start = codePointOffset(draft, utf16Start);
    const end = codePointOffset(draft, utf16Start + "🚲 bikes".length);
    const selected = sliceByCodePoints(draft, start, end);
    const proposal = {
      canAccept: true,
      claims: [],
      createdAt: "2026-08-04T00:00:00.000Z",
      essayId: "ab000000-0000-4000-8000-000000000001" as EssayId,
      expiresAt: "2026-08-05T00:00:00.000Z",
      id: "ab100000-0000-4000-8000-000000000001" as AiProposalId,
      instruction: "CLARIFY",
      kind: "REWRITE",
      proposedText: "community bicycles",
      rationale: "Clarifies the object.",
      selection: { end, start, textHash: createDraftTextHash(selected) },
      status: "PENDING",
      targetRevision: 1,
      userId: "ab200000-0000-4000-8000-000000000001" as UserId,
    } satisfies RewriteProposal;
    expect(selected).toBe("🚲 bikes");
    expect(applyRewriteProposal(draft, proposal)).toBe(
      "I repair community bicycles.",
    );
  });
});
