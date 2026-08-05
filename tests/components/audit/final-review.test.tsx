import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinalReview } from "@/components/essay/final-review";

const essayId = "ef100000-0000-4000-8000-000000000001";
const now = "2026-08-04T21:00:00.000Z";
const metrics = {
  distinctReferenceFourGramCount: 0,
  fourGramOverlapRatio: 0,
  longestContiguousMatch: 0,
  matchedReferenceFourGramCount: 0,
  referenceTokenCount: 0,
  studentTokenCount: 9,
  substantiallySimilar: false,
  thresholdCode: "NO_REFERENCE",
};
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: "ef900000-0000-4000-8000-000000000001" },
});

function audit(status: "PASS" | "BLOCKED") {
  return {
    createdAt: now,
    essayId,
    essayRevision: 9,
    evidenceManifestVersion: `v1.${"m".repeat(43)}`,
    id: "ef200000-0000-4000-8000-000000000001",
    issues:
      status === "PASS"
        ? []
        : [
            {
              code: "EMPTY_DRAFT",
              evidenceIds: [],
              message: "Write a student-authored draft before final review.",
              severity: "BLOCKING",
            },
            {
              code: "REFERENCE_CLAIM_UNDECIDED",
              evidenceIds: ["ef300000-0000-4000-8000-000000000001"],
              message: "Review every factual claim before export.",
              severity: "BLOCKING",
            },
          ],
    similarity: metrics,
    status,
    userId: "ef000000-0000-4000-8000-000000000001",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("final review", () => {
  it("links every issue to a recovery action and keeps export blocked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope(audit("BLOCKED"))), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<FinalReview essayId={essayId} essayRevision={9} />);

    await user.click(screen.getByRole("button", { name: "Run final review" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Export is blocked",
    );
    expect(
      screen.getByRole("link", { name: "Return to your draft" }),
    ).toHaveAttribute("href", "#draft-heading");
    expect(
      screen.getByRole("link", { name: "Review reference claims" }),
    ).toHaveAttribute("href", "#reference-draft-heading");
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
    expect(screen.getByText(/institution.?s AI policy/i)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/audits`,
      expect.objectContaining({
        body: "{}",
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
  });

  it("copies only server-approved student text after a passing review", async () => {
    const studentDraft = "This is only the editable student draft.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope(audit("PASS"))), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(studentDraft, {
          headers: { "content-type": "text/plain; charset=utf-8" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<FinalReview essayId={essayId} essayRevision={9} />);

    await user.click(screen.getByRole("button", { name: "Run final review" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Ready to export",
    );
    await user.click(
      screen.getByRole("button", { name: "Copy student draft" }),
    );

    expect(writeText).toHaveBeenCalledWith(studentDraft);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/essays/${essayId}/export.txt`,
      { cache: "no-store" },
    );
    expect(await screen.findByText("Student draft copied.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download .txt" })).toBeEnabled();
  });

  it("invalidates visible approval when the essay revision changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(envelope(audit("PASS"))), {
          status: 201,
        }),
      ),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <FinalReview essayId={essayId} essayRevision={9} />,
    );
    await user.click(screen.getByRole("button", { name: "Run final review" }));
    expect(
      await screen.findByRole("button", { name: "Copy student draft" }),
    ).toBeVisible();

    rerender(<FinalReview essayId={essayId} essayRevision={10} />);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.getByText(/run final review again/i)).toBeVisible();
  });
});
