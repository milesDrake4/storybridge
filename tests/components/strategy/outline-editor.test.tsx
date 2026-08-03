import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutlineEditor } from "@/components/essay/outline-editor";
import { outlineV1Schema } from "@/contracts/http/v1/outlines";

const now = "2026-08-03T20:00:00.000Z";
const essayId = "b1000000-0000-4000-8000-000000000001";
const angleId = "b2000000-0000-4000-8000-000000000001";
const factId = "b3000000-0000-4000-8000-000000000001";
const sourceId = "b4000000-0000-4000-8000-000000000001";
const outline = outlineV1Schema.parse({
  schemaVersion: "1",
  sections: [
    ["b5000000-0000-4000-8000-000000000001", "Open with the workshop", 90],
    ["b5000000-0000-4000-8000-000000000002", "Show collaborative growth", 100],
    ["b5000000-0000-4000-8000-000000000003", "Connect growth to campus", 110],
  ].map(([id, purpose, targetWords]) => ({
    id,
    purpose,
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    targetWords: Number(targetWords),
  })),
});
const proposal = {
  canAccept: false as const,
  createdAt: now,
  essayId,
  expiresAt: "2026-08-04T20:00:00.000Z",
  id: "b6000000-0000-4000-8000-000000000001",
  kind: "OUTLINE" as const,
  outline,
  rationale: "This structure moves from a grounded moment to future fit.",
  selectedAngleId: angleId,
  status: "PENDING" as const,
  targetRevision: 3,
  userId: "b0000000-0000-4000-8000-000000000001",
};

function envelope(data: unknown) {
  return {
    apiVersion: "1",
    data,
    meta: { requestId: "b9000000-0000-4000-8000-000000000001" },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("outline proposal and editing", () => {
  it("keeps a proposal read-only until explicit copy and preserves edits on conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope(proposal)), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: {} }), { status: 412 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <OutlineEditor
        essayId={essayId}
        essayRevision={3}
        initialOutline={null}
        selectedAngleId={angleId}
        wordLimit={300}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Propose an outline" }),
    );
    expect(await screen.findByText("Suggested structure")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Your editable outline" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Start from this outline" }),
    );
    await user.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getAllByRole("group")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Remove section 4" }));
    expect(screen.getAllByRole("group")).toHaveLength(3);
    const purpose = screen.getAllByRole("textbox", { name: "Purpose" })[0];
    await user.clear(purpose);
    await user.type(purpose, "A locally edited opening");
    await user.click(screen.getByRole("button", { name: "Save outline" }));

    expect(await screen.findByText(/changed elsewhere/)).toBeVisible();
    expect(purpose).toHaveValue("A locally edited opening");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/essays/${essayId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "if-match": `"essay:${essayId}:r3"`,
        }),
        method: "PATCH",
      }),
    );
  });

  it("saves a valid existing outline and reports drafting unlocked", async () => {
    const onRevisionChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            envelope({
              createdAt: now,
              dossierId: "b7000000-0000-4000-8000-000000000001",
              draftText: "",
              id: essayId,
              outline,
              prompt:
                "Describe a community that shaped how you contribute today.",
              revision: 4,
              schoolId: "b8000000-0000-4000-8000-000000000001",
              season: "2026-2027",
              selectedAngleId: angleId,
              status: "DRAFTING",
              updatedAt: now,
              userId: proposal.userId,
              wordLimit: 300,
            }),
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <OutlineEditor
        essayId={essayId}
        essayRevision={3}
        initialOutline={outline}
        onRevisionChange={onRevisionChange}
        selectedAngleId={angleId}
        wordLimit={300}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save outline" }));
    expect(await screen.findByText(/Drafting is now unlocked/)).toBeVisible();
    expect(onRevisionChange).toHaveBeenCalledWith(4);
  });
});
