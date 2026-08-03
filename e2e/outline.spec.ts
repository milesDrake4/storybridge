import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(process.cwd(), "test-results/auth/outline.json");
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
const userId = "d0000000-0000-4000-8000-000000000001";
const essayId = "d1000000-0000-4000-8000-000000000001";
const dossierId = "d2000000-0000-4000-8000-000000000001";
const sourceId = "d3000000-0000-4000-8000-000000000001";
const factId = "d4000000-0000-4000-8000-000000000001";
const angleId = "d5000000-0000-4000-8000-000000000001";
const outline = {
  schemaVersion: "1",
  sections: [1, 2, 3].map((position) => ({
    id: `d6000000-0000-4000-8000-00000000000${position}`,
    purpose: `Purpose ${position}`,
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    targetWords: 100,
  })),
};
const proposal = {
  canAccept: false,
  createdAt: now,
  essayId,
  expiresAt: "2026-08-04T20:00:00.000Z",
  id: "d7000000-0000-4000-8000-000000000001",
  kind: "OUTLINE",
  outline,
  rationale: "Move from a concrete contribution to future campus fit.",
  selectedAngleId: angleId,
  status: "PENDING",
  targetRevision: 3,
  userId,
};
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("explicitly copies, edits, saves, and reloads an outline", async ({
  page,
}) => {
  let savedOutline: typeof outline | null = null;
  let revision = 3;
  const essay = () => ({
    createdAt: now,
    dossierId,
    draftText: "",
    id: essayId,
    outline: savedOutline,
    prompt: "How will your experiences help you contribute to our community?",
    revision,
    schoolId: "d8000000-0000-4000-8000-000000000001",
    season: "2026-2027",
    selectedAngleId: angleId,
    status: savedOutline ? "DRAFTING" : "OUTLINING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  });

  await page.route(`**/api/v1/essays/${essayId}/outline-proposals`, (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    return route.fulfill({ json: envelope(proposal), status: 201 });
  });
  await page.route(`**/api/v1/essays/${essayId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["if-match"]).toBe(
        `"essay:${essayId}:r3"`,
      );
      savedOutline = route.request().postDataJSON().outline;
      revision = 4;
      await route.fulfill({ json: envelope(essay()) });
      return;
    }
    await route.fulfill({
      json: envelope({
        essay: essay(),
        school: {
          canonicalName: "University of Michigan",
          id: essay().schoolId,
          officialDomain: "umich.edu",
        },
      }),
    });
  });
  await page.route(`**/api/v1/essays/${essayId}/research`, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route(`**/api/v1/essays/${essayId}/angles`, (route) =>
    route.fulfill({ json: envelope({ angles: [] }) }),
  );

  await page.goto(`/essays/${essayId}`);
  await page.getByRole("button", { name: "Propose an outline" }).click();
  await expect(page.getByText("Suggested structure")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your editable outline" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Start from this outline" }).click();
  await page.getByLabel("Purpose").first().fill("A student-edited opening");
  await page.getByRole("button", { name: "Save outline" }).click();
  await expect(page.getByText(/Drafting is now unlocked/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Purpose").first()).toHaveValue(
    "A student-edited opening",
  );
});
