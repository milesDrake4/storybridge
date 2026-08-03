import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchPanel } from "@/components/essay/research-panel";
import type { SchoolDossier } from "@/contracts/domain/school-dossier";

const essayId = "b1000000-0000-4000-8000-000000000001";
const now = "2026-08-03T18:00:00.000Z";
const dossier = {
  createdAt: now,
  essayId,
  id: "b2000000-0000-4000-8000-000000000001",
  schemaVersion: "1",
  schoolId: "b3000000-0000-4000-8000-000000000001",
  sources: [
    {
      category: "ACADEMICS",
      claim: "Students can pursue interdisciplinary study.",
      id: "b4000000-0000-4000-8000-000000000001",
      normalizedUrl: "https://umich.edu/academics",
      retrievedAt: now,
      supportingExcerpt:
        "Students can pursue interdisciplinary study across schools.",
      title: "Academics at Michigan",
    },
  ],
  summary: "Evidence-backed overview.",
  updatedAt: now,
  userId: "b0000000-0000-4000-8000-000000000001",
} as SchoolDossier;

afterEach(() => vi.unstubAllGlobals());

function success(data: unknown) {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      data,
      meta: { requestId: "b9000000-0000-4000-8000-000000000001" },
    }),
    { headers: { "content-type": "application/json" }, status: 201 },
  );
}

describe("cited school research panel", () => {
  it("shows category, excerpt, retrieval time, and a clickable citation for every claim", () => {
    render(<ResearchPanel essayId={essayId} initialDossier={dossier} />);

    expect(screen.getByText("academics")).toBeVisible();
    expect(screen.getByRole("blockquote")).toHaveTextContent(
      "interdisciplinary study across schools",
    );
    expect(screen.getByText(/Retrieved Aug 3, 2026/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Academics at Michigan/ }),
    ).toHaveAttribute("href", "https://umich.edu/academics");
  });

  it("starts research with idempotency and renders only the validated server result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success(dossier));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ResearchPanel essayId={essayId} initialDossier={null} />);

    await user.click(
      screen.getByRole("button", { name: "Research this school" }),
    );

    expect(await screen.findByText(dossier.sources[0].claim)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/research`,
      expect.objectContaining({
        headers: { "idempotency-key": expect.any(String) },
        method: "POST",
      }),
    );
  });

  it("offers a typed retry after timeout and keeps the existing essay context visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: "1",
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Unavailable",
              retryable: true,
            },
            meta: { requestId: "b9000000-0000-4000-8000-000000000002" },
          }),
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ResearchPanel essayId={essayId} initialDossier={null} />);
    await user.click(
      screen.getByRole("button", { name: "Research this school" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nothing was saved or changed",
    );
    expect(
      screen.getByRole("button", { name: "Retry school research" }),
    ).toBeVisible();
  });
});
