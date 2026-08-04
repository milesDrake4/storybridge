import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReferenceDraftPanel } from "@/components/essay/reference-draft-panel";
import type { ReferenceDraftProposal } from "@/contracts/http/v1/reference-drafts";

const now = "2026-08-04T13:00:00.000Z";
const essayId = "f1000000-0000-4000-8000-000000000001";
const claimId = "f2000000-0000-4000-8000-000000000001";
const userId = "f0000000-0000-4000-8000-000000000001";
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: "f9000000-0000-4000-8000-000000000001" },
});
const proposal = {
  acknowledgmentVersion: "reference-draft-2026-08-02",
  canAccept: false,
  claims: [
    {
      contentHmac: `v1.${"c".repeat(43)}`,
      decidedAt: null,
      decision: null,
      end: 43,
      evidence: {
        schoolSources: [
          {
            claim: "The school supports community repair partnerships.",
            id: "f4000000-0000-4000-8000-000000000001",
            title: "Community partnerships",
          },
        ],
        storyFacts: [
          {
            id: "f5000000-0000-4000-8000-000000000001",
            summary: "Organized a neighborhood bicycle repair day.",
          },
        ],
      },
      id: claimId,
      schoolSourceIds: ["f4000000-0000-4000-8000-000000000001"],
      start: 0,
      status: "SUPPORTED",
      storyFactIds: ["f5000000-0000-4000-8000-000000000001"],
      text: "I organized a community bicycle repair day.",
    },
  ],
  createdAt: now,
  essayId,
  expiresAt: "2026-08-05T13:00:00.000Z",
  id: "f3000000-0000-4000-8000-000000000001",
  kind: "REFERENCE_DRAFT",
  rationale: "A source-bound example.",
  referenceText: "I organized a community bicycle repair day.",
  status: "PENDING",
  targetRevision: 7,
  userId,
} as ReferenceDraftProposal;

afterEach(() => vi.unstubAllGlobals());

describe("reference draft panel", () => {
  it("requires acknowledgment and renders generated text as read-only evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(proposal)), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ReferenceDraftPanel essayId={essayId} />);

    const generate = screen.getByRole("button", {
      name: "Generate my one reference draft",
    });
    expect(generate).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I understand this is an AI/i }),
    );
    expect(generate).toBeEnabled();
    await user.click(generate);

    expect(
      await screen.findByLabelText("AI reference draft"),
    ).toHaveTextContent(proposal.referenceText);
    expect(
      screen.queryByRole("textbox", { name: /reference draft/i }),
    ).toBeNull();
    expect(screen.getByText(/neighborhood bicycle repair day/i)).toBeVisible();
    expect(screen.getByText(/community partnerships/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /accept|copy|insert|export/i }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/reference-draft`,
      expect.objectContaining({
        body: JSON.stringify({
          acknowledgmentVersion: "reference-draft-2026-08-02",
        }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
      }),
    );
  });

  it("records a decision once and replaces its actions with immutable status", async () => {
    const confirmation = {
      claimContentHmac: proposal.claims[0].contentHmac,
      claimId,
      decidedAt: now,
      decision: "REJECTED",
      essayId,
      userId,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(confirmation)), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <ReferenceDraftPanel essayId={essayId} initialProposal={proposal} />,
    );

    await user.click(screen.getByRole("button", { name: "Reject claim" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Rejected — remove this claim/i);
    expect(screen.queryByRole("button", { name: "Reject claim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm claim" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/reference-claim-confirmations/${claimId}`,
      expect.objectContaining({
        body: JSON.stringify({ decision: "REJECT" }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "PUT",
      }),
    );
  });

  it("preserves both decision choices when persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();
    render(
      <ReferenceDraftPanel essayId={essayId} initialProposal={proposal} />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be verified/i,
    );
    const actions = screen.getByRole("button", {
      name: "Confirm claim",
    }).parentElement!;
    expect(
      within(actions).getByRole("button", { name: "Confirm claim" }),
    ).toBeEnabled();
    expect(
      within(actions).getByRole("button", { name: "Reject claim" }),
    ).toBeEnabled();
  });
});
