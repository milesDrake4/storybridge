import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProposalDiff } from "@/components/essay/proposal-diff";
import type { AiProposalId, EssayId, UserId } from "@/contracts/domain/ids";
import type { RewriteProposal } from "@/contracts/http/v1/proposals";
import { createDraftTextHash } from "@/lib/security/draft-hash";

const draftText = "I repaired bicycles with neighbors.";
const selected = "repaired bicycles";
const start = draftText.indexOf(selected);

function proposal(status: "SUPPORTED" | "BLOCKING_UNSUPPORTED") {
  return {
    canAccept: true,
    claims: [
      {
        schoolSourceIds: [],
        status,
        storyFactIds: [],
        text: "A factual claim",
      },
    ],
    createdAt: "2026-08-04T00:00:00.000Z",
    essayId: "a1000000-0000-4000-8000-000000000001" as EssayId,
    expiresAt: "2026-08-05T00:00:00.000Z",
    id: "a2000000-0000-4000-8000-000000000001" as AiProposalId,
    instruction: "CLARIFY",
    kind: "REWRITE",
    proposedText: "fixed bikes",
    rationale: "More direct.",
    selection: {
      end: start + selected.length,
      start,
      textHash: createDraftTextHash(selected),
    },
    status: "PENDING",
    targetRevision: 4,
    userId: "a0000000-0000-4000-8000-000000000001" as UserId,
  } satisfies RewriteProposal;
}

describe("proposal diff", () => {
  it("shows exact current and replacement text before explicit acceptance", () => {
    const onAccept = vi.fn();
    render(
      <ProposalDiff
        draftText={draftText}
        onAccept={onAccept}
        onDismiss={vi.fn()}
        proposal={proposal("SUPPORTED")}
      />,
    );
    expect(screen.getByText(selected)).toBeVisible();
    expect(screen.getByText("fixed bikes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Accept this change" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("blocks acceptance for unsupported generated claims", () => {
    render(
      <ProposalDiff
        draftText={draftText}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
        proposal={proposal("BLOCKING_UNSUPPORTED")}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /unsupported factual claim/i,
    );
    expect(
      screen.getByRole("button", { name: "Accept this change" }),
    ).toBeDisabled();
  });

  it("lets the student dismiss the preview without applying it", () => {
    const onDismiss = vi.fn();
    const onAccept = vi.fn();
    render(
      <ProposalDiff
        draftText={draftText}
        onAccept={onAccept}
        onDismiss={onDismiss}
        proposal={proposal("SUPPORTED")}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Keep my current draft" }),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
