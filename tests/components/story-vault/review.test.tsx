import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryVaultReview } from "@/components/story-vault/story-vault-review";
import type { StoryProfileWithFacts } from "@/contracts/domain/story-vault";

const now = "2026-08-02T20:00:00.000Z";
const factId = "d2000000-0000-4000-8000-000000000001";
const profileId = "d1000000-0000-4000-8000-000000000001";
const vault = {
  facts: [
    {
      category: "ACADEMICS",
      contentHmac: "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      createdAt: now,
      details: ["Returns repeatedly to synthetic biology"],
      id: factId,
      profileId,
      revision: 1,
      sourceMessageIds: ["d3000000-0000-4000-8000-000000000001"],
      sources: [
        {
          content: "Synthetic biology keeps pulling me back.",
          id: "d3000000-0000-4000-8000-000000000001",
          questionKey: "ACADEMIC_INTERESTS",
        },
      ],
      summary: "Sustained academic interest",
      suppressedAt: null,
      updatedAt: now,
      userId: "d0000000-0000-4000-8000-000000000001",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
    },
  ],
  profile: {
    createdAt: now,
    excludedTopics: [],
    id: profileId,
    revision: 1,
    sourceSessionId: "d4000000-0000-4000-8000-000000000001",
    status: "REVIEW_REQUIRED",
    updatedAt: now,
    userId: "d0000000-0000-4000-8000-000000000001",
    version: 1,
    voiceProfile: {
      sentenceStyle: "Direct, then reflective",
      toneTraits: ["reflective"],
      vocabulary: "Concrete and restrained",
    },
  },
} as unknown as StoryProfileWithFacts;

afterEach(() => vi.unstubAllGlobals());

function success(data: unknown) {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      data,
      meta: { requestId: "d9000000-0000-4000-8000-000000000001" },
    }),
    { status: 200 },
  );
}

describe("Story Vault review", () => {
  it("shows source evidence and explicit review controls", async () => {
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    expect(
      screen.getByRole("heading", { name: "Sustained academic interest" }),
    ).toBeVisible();
    await user.click(screen.getByText("View 1 interview source"));
    expect(
      screen.getByText("Synthetic biology keeps pulling me back."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Verify" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide from AI" })).toBeVisible();
  });

  it("edits with the current ETag and renders the server-confirmed revision", async () => {
    const updated = {
      ...vault.facts[0],
      details: ["Edited detail"],
      revision: 2,
      summary: "Edited summary",
      verificationStatus: "UNVERIFIED",
    };
    const fetchMock = vi.fn().mockResolvedValue(success(updated));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Summary"));
    await user.type(screen.getByLabelText("Summary"), "Edited summary");
    await user.clear(screen.getByLabelText("Details, one per line"));
    await user.type(
      screen.getByLabelText("Details, one per line"),
      "Edited detail",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByRole("heading", { name: "Edited summary" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/story-facts/${factId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "if-match": `"fact:${factId}:r1"`,
        }),
        method: "PATCH",
      }),
    );
  });

  it("keeps unsaved edits open when the server rejects the change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: "1",
            error: { code: "REVISION_MISMATCH", message: "Reload required" },
            meta: { requestId: "d9000000-0000-4000-8000-000000000002" },
          }),
          { status: 412 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Summary"));
    await user.type(screen.getByLabelText("Summary"), "Unsaved summary");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByLabelText("Summary")).toHaveValue(
      "Unsaved summary",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "That change could not be saved",
    );
  });

  it("binds verification to the visible content hash and revision", async () => {
    const verified = {
      ...vault.facts[0],
      revision: 2,
      verificationStatus: "VERIFIED",
      verifiedAt: now,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(verified));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("verified")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/story-facts/${factId}/verification`,
      expect.objectContaining({
        body: JSON.stringify({
          contentHash: vault.facts[0].contentHmac,
          decision: "VERIFY",
          expectedRevision: 1,
        }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
          "if-match": `"fact:${factId}:r1"`,
        }),
      }),
    );
  });

  it("suppresses a fact from AI and offers restoration", async () => {
    const suppressed = {
      ...vault.facts[0],
      revision: 2,
      suppressedAt: now,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(suppressed));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.click(screen.getByRole("button", { name: "Hide from AI" }));

    expect(
      await screen.findByRole("button", { name: "Restore to AI" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/story-facts/${factId}/suppression`,
      expect.objectContaining({
        body: JSON.stringify({ suppressed: true }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "PUT",
      }),
    );
  });

  it("saves user-controlled excluded topics with the profile ETag", async () => {
    const updatedProfile = {
      ...vault.profile,
      excludedTopics: ["family health"],
      revision: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(updatedProfile));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.type(
      screen.getByLabelText("Topics to keep out of AI assistance"),
      "family health",
    );
    await user.click(
      screen.getByRole("button", { name: "Save privacy preferences" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Privacy preferences saved",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/story-profile",
      expect.objectContaining({
        body: JSON.stringify({ excludedTopics: ["family health"] }),
        headers: expect.objectContaining({
          "if-match": `"profile:${profileId}:r1"`,
        }),
      }),
    );
  });

  it("requires explicit confirmation before deleting a fact", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryVaultReview initialVault={vault} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Fact deleted");
    expect(
      screen.queryByRole("heading", { name: "Sustained academic interest" }),
    ).not.toBeInTheDocument();
  });
});
