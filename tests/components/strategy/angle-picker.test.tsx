import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnglePicker } from "@/components/essay/angle-picker";

const now = "2026-08-03T20:00:00.000Z";
const essayId = "a1000000-0000-4000-8000-000000000001";
const factId = "a2000000-0000-4000-8000-000000000001";
const sourceId = "a3000000-0000-4000-8000-000000000001";
const angleId = "a4000000-0000-4000-8000-000000000001";

const angle = {
  createdAt: now,
  dossierId: "a5000000-0000-4000-8000-000000000001",
  essayId,
  id: angleId,
  position: 1,
  promptFit: "Connects a concrete act of service to future collaboration.",
  risk: "Avoid making one workshop sound larger than it was.",
  schoolSourceIds: [sourceId],
  selectedAt: null,
  storyFactIds: [factId],
  thesis: "Repairing objects taught me to build trust beside other people.",
  title: "Repair as relationship",
  updatedAt: now,
  userId: "a0000000-0000-4000-8000-000000000001",
};
const angles = [
  angle,
  {
    ...angle,
    id: "a4000000-0000-4000-8000-000000000002",
    position: 2,
    thesis: "Curiosity became meaningful when it was useful to neighbors.",
    title: "Curiosity made useful",
  },
  {
    ...angle,
    id: "a4000000-0000-4000-8000-000000000003",
    position: 3,
    thesis: "Listening changed my definition of community leadership.",
    title: "Leadership by listening",
  },
];

function envelope(data: unknown) {
  return {
    apiVersion: "1",
    data,
    meta: { requestId: "a9000000-0000-4000-8000-000000000001" },
  };
}

const dossier = {
  createdAt: now,
  essayId,
  id: angle.dossierId,
  schemaVersion: "1",
  schoolId: "a6000000-0000-4000-8000-000000000001",
  sources: [
    {
      category: "COMMUNITY",
      claim: "Students collaborate through community projects.",
      id: sourceId,
      normalizedUrl: "https://umich.edu/community",
      retrievedAt: now,
      supportingExcerpt: "Projects connect students across fields.",
      title: "Community projects",
    },
  ],
  summary: "Cited community evidence.",
  updatedAt: now,
  userId: angle.userId,
};
const profile = {
  facts: [
    {
      category: "EXPERIENCES",
      contentHmac: `v1.${"A".repeat(43)}`,
      createdAt: now,
      details: ["Organized a repair workshop."],
      id: factId,
      profileId: "a7000000-0000-4000-8000-000000000001",
      revision: 1,
      sourceMessageIds: ["a8000000-0000-4000-8000-000000000001"],
      sources: [
        {
          content: "I organized a repair workshop.",
          id: "a8000000-0000-4000-8000-000000000001",
          questionKey: "experience_1",
        },
      ],
      summary: "Built community through a repair workshop.",
      suppressedAt: null,
      updatedAt: now,
      userId: angle.userId,
      verificationStatus: "VERIFIED",
      verifiedAt: now,
    },
  ],
  profile: {
    createdAt: now,
    excludedTopics: [],
    id: "a7000000-0000-4000-8000-000000000001",
    revision: 1,
    sourceSessionId: "a8000000-0000-4000-8000-000000000002",
    status: "ACTIVE",
    updatedAt: now,
    userId: angle.userId,
    version: 1,
    voiceProfile: {
      sentenceStyle: "Varied",
      toneTraits: ["direct"],
      vocabulary: "Plain",
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("angle comparison and selection", () => {
  it("shows linked evidence, supports a working edit, and persists selection", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/research")) {
        return new Response(JSON.stringify(envelope(dossier)));
      }
      if (url === "/api/v1/story-profile") {
        return new Response(JSON.stringify(envelope(profile)));
      }
      if (url.includes("/selection") && init?.method === "POST") {
        return new Response(JSON.stringify(envelope({})), { status: 200 });
      }
      if (url.endsWith(`/${angleId}`) && init?.method === "PATCH") {
        return new Response(
          JSON.stringify(
            envelope({
              ...angle,
              ...(JSON.parse(String(init.body)) as object),
            }),
          ),
        );
      }
      return new Response(JSON.stringify(envelope({ angles })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <AnglePicker
        essayId={essayId}
        initialEssayRevision={1}
        initialSelectedAngleId={null}
      />,
    );

    expect(await screen.findByText("Repair as relationship")).toBeVisible();
    expect(
      await screen.findAllByText("Built community through a repair workshop."),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("link", {
        name: /Students collaborate through community projects/,
      })[0],
    ).toHaveAttribute("href", "https://umich.edu/community");
    expect(screen.getAllByText(/Avoid making one workshop/)[0]).toBeVisible();

    await user.click(
      screen.getAllByRole("button", { name: "Edit this strategy" })[0],
    );
    const thesis = screen.getByRole("textbox", { name: "Working thesis" });
    await user.clear(thesis);
    await user.type(thesis, "A sharper working thesis.");
    expect(thesis).toHaveValue("A sharper working thesis.");
    await user.click(
      screen.getByRole("button", { name: "Save strategy edit" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/angles/${angleId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "if-match": `"essay:${essayId}:r1"`,
        }),
        method: "PATCH",
      }),
    );

    await user.click(
      screen.getAllByRole("button", { name: "Select this angle" })[0],
    );
    expect(
      await screen.findByRole("button", { name: "Selected" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}/angles/${angleId}/selection`,
      expect.objectContaining({
        body: "{}",
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
  });

  it("shows the single targeted recovery question for insufficient evidence", async () => {
    const question = "What specific experience changed how you contribute?";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(envelope({ angles: [] }))),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              apiVersion: "1",
              error: {
                code: "INSUFFICIENT_EVIDENCE",
                followUpQuestion: question,
                message: "More evidence is required.",
                retryable: false,
              },
              meta: { requestId: "a9000000-0000-4000-8000-000000000002" },
            }),
            { status: 422 },
          ),
        ),
    );
    const user = userEvent.setup();
    render(
      <AnglePicker
        essayId={essayId}
        initialEssayRevision={1}
        initialSelectedAngleId={null}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Generate three angles" }),
    );

    expect(await screen.findByText(question)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review your Story Vault" }),
    ).toHaveAttribute("href", "/story-vault");
  });
});
