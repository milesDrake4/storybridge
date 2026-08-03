import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoachPanel } from "@/components/essay/coach-panel";

const essayId = "c1000000-0000-4000-8000-000000000001";
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: "c9000000-0000-4000-8000-000000000001" },
});
const advice = {
  canAccept: false,
  createdAt: "2026-08-03T22:00:00.000Z",
  essayId,
  expiresAt: "2026-08-04T22:00:00.000Z",
  guidance: ["Name the specific choice you made and why it mattered."],
  headline: "Make your agency more visible",
  id: "c2000000-0000-4000-8000-000000000001",
  kind: "ADVICE",
  rationale: "The current draft emphasizes events more than your decision.",
  status: "PENDING",
  targetRevision: 4,
  userId: "c0000000-0000-4000-8000-000000000001",
};

afterEach(() => vi.unstubAllGlobals());

describe("advice-only coach", () => {
  it("shows immutable guidance with no insertion action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(envelope(advice)), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CoachPanel essayId={essayId} />);
    const question = screen.getByRole("textbox", {
      name: "What would you like help with?",
    });
    await user.type(question, "How can I make my role clearer?");
    await user.click(
      screen.getByRole("button", { name: "Get coaching advice" }),
    );
    expect(await screen.findByText(advice.headline)).toBeVisible();
    expect(screen.getByText(/no insertion action/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /insert|accept/i })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/coach-proposals`,
      expect.objectContaining({
        body: JSON.stringify({ question: "How can I make my role clearer?" }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
      }),
    );
  });

  it("preserves the question when coaching fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();
    render(<CoachPanel essayId={essayId} />);
    const question = screen.getByRole("textbox", {
      name: "What would you like help with?",
    });
    await user.type(question, "Please help with focus.");
    await user.click(
      screen.getByRole("button", { name: "Get coaching advice" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(question).toHaveValue("Please help with focus.");
  });
});
