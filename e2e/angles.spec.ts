import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(process.cwd(), "test-results/auth/angles.json");
let cleanup: (() => Promise<void>) | undefined;
test.use({ storageState: process.env.E2E_AUTH_STORAGE_STATE ?? storageState });
test.beforeAll(async () => {
  if (!process.env.E2E_AUTH_STORAGE_STATE) {
    cleanup = await prepareLocalInvitedAdultStorageState({
      appUrl: new URL("http://127.0.0.1:3100"),
      path: storageState,
    });
  }
});
test.afterAll(async () => cleanup?.());

const now = "2026-08-03T20:00:00.000Z";
const userId = "c0000000-0000-4000-8000-000000000001";
const essayId = "c1000000-0000-4000-8000-000000000001";
const dossierId = "c2000000-0000-4000-8000-000000000001";
const sourceId = "c3000000-0000-4000-8000-000000000001";
const factId = "c4000000-0000-4000-8000-000000000001";
const angles = [1, 2, 3].map((position) => ({
  createdAt: now,
  dossierId,
  essayId,
  id: `c5000000-0000-4000-8000-00000000000${position}`,
  position,
  promptFit: `Prompt-fit explanation ${position}.`,
  risk: `Specific weakness warning ${position}.`,
  schoolSourceIds: [sourceId],
  selectedAt: null,
  storyFactIds: [factId],
  thesis: `Materially distinct thesis ${position}.`,
  title: `Strategy ${position}`,
  updatedAt: now,
  userId,
}));
const dossier = {
  createdAt: now,
  essayId,
  id: dossierId,
  schemaVersion: "1",
  schoolId: "c6000000-0000-4000-8000-000000000001",
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
  userId,
};
const profile = {
  facts: [
    {
      category: "EXPERIENCES",
      contentHmac: `v1.${"A".repeat(43)}`,
      createdAt: now,
      details: ["Organized a repair workshop."],
      id: factId,
      profileId: "c7000000-0000-4000-8000-000000000001",
      revision: 1,
      sourceMessageIds: ["c8000000-0000-4000-8000-000000000001"],
      sources: [
        {
          content: "I organized a repair workshop.",
          id: "c8000000-0000-4000-8000-000000000001",
          questionKey: "experience_1",
        },
      ],
      summary: "Built community through a repair workshop.",
      suppressedAt: null,
      updatedAt: now,
      userId,
      verificationStatus: "VERIFIED",
      verifiedAt: now,
    },
  ],
  profile: {
    createdAt: now,
    excludedTopics: [],
    id: "c7000000-0000-4000-8000-000000000001",
    revision: 1,
    sourceSessionId: "c8000000-0000-4000-8000-000000000002",
    status: "ACTIVE",
    updatedAt: now,
    userId,
    version: 1,
    voiceProfile: {
      sentenceStyle: "Varied",
      toneTraits: ["direct"],
      vocabulary: "Plain",
    },
  },
};
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("compares evidence-linked angles and preserves selection on reload", async ({
  page,
}) => {
  let selectedAngleId: string | null = null;
  await page.route(`**/api/v1/essays/${essayId}`, (route) =>
    route.fulfill({
      json: envelope({
        essay: {
          createdAt: now,
          dossierId,
          draftText: "",
          id: essayId,
          outline: null,
          prompt: "How will your experiences help you contribute?",
          revision: selectedAngleId ? 2 : 1,
          schoolId: dossier.schoolId,
          season: "2026-2027",
          selectedAngleId,
          status: selectedAngleId ? "OUTLINING" : "STRATEGY",
          updatedAt: now,
          userId,
          wordLimit: 300,
        },
        school: {
          canonicalName: "University of Michigan",
          id: dossier.schoolId,
          officialDomain: "umich.edu",
        },
      }),
    }),
  );
  await page.route(`**/api/v1/essays/${essayId}/research`, (route) =>
    route.fulfill({ json: envelope(dossier) }),
  );
  await page.route(`**/api/v1/story-profile`, (route) =>
    route.fulfill({ json: envelope(profile) }),
  );
  await page.route(`**/api/v1/essays/${essayId}/angles`, (route) =>
    route.fulfill({ json: envelope({ angles }) }),
  );
  await page.route(
    `**/api/v1/essays/${essayId}/angles/*/selection`,
    async (route) => {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      selectedAngleId = angles[0].id;
      await route.fulfill({ json: envelope({}), status: 200 });
    },
  );

  await page.goto(`/essays/${essayId}`);
  await expect(page.getByText("Strategy 1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Built community through a repair workshop.").first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", {
        name: /Students collaborate through community projects/,
      })
      .first(),
  ).toHaveAttribute("href", "https://umich.edu/community");

  await page.getByRole("button", { name: "Select this angle" }).first().click();
  await expect(page.getByRole("button", { name: "Selected" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Selected" })).toBeVisible();
});
