import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(process.cwd(), "test-results/auth/editor.json");
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

const now = "2026-08-03T22:00:00.000Z";
const essayId = "b1000000-0000-4000-8000-000000000001";
const userId = "b0000000-0000-4000-8000-000000000001";
const schoolId = "b2000000-0000-4000-8000-000000000001";
const angleId = "b3000000-0000-4000-8000-000000000001";
const sourceId = "b4000000-0000-4000-8000-000000000001";
const factId = "b5000000-0000-4000-8000-000000000001";
const outline = {
  schemaVersion: "1",
  sections: [1, 2, 3].map((position) => ({
    id: `b6000000-0000-4000-8000-00000000000${position}`,
    purpose: `Purpose ${position}`,
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    targetWords: 100,
  })),
};
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("autosaves, reloads, and resolves a concurrent draft explicitly", async ({
  page,
}) => {
  let draftText = "Opening saved text";
  let revision = 4;
  let conflictOnce = false;
  const essay = () => ({
    createdAt: now,
    dossierId: "b7000000-0000-4000-8000-000000000001",
    draftText,
    id: essayId,
    outline,
    prompt: "Describe a community that shaped how you contribute today.",
    revision,
    schoolId,
    season: "2026-2027",
    selectedAngleId: angleId,
    status: "DRAFTING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  });

  await page.route(`**/api/v1/essays/${essayId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      if (conflictOnce) {
        conflictOnce = false;
        draftText = "Saved concurrently on another device";
        revision += 1;
        await route.fulfill({ json: {}, status: 412 });
        return;
      }
      expect(route.request().headers()["if-match"]).toBe(
        `"essay:${essayId}:r${revision}"`,
      );
      draftText = route.request().postDataJSON().draftText;
      revision += 1;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await route.fulfill({ json: envelope(essay()) });
      return;
    }
    await route.fulfill({
      json: envelope({
        essay: essay(),
        school: {
          canonicalName: "University of Michigan",
          id: schoolId,
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
  const editor = page.getByRole("textbox", { name: "Essay draft" });
  await editor.fill("A locally written first revision");
  await expect(page.getByText("Saving", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor).toHaveValue("A locally written first revision");

  conflictOnce = true;
  await editor.fill("Local work that must not disappear");
  await editor.blur();
  await expect(
    page.getByRole("heading", { name: "This draft changed elsewhere" }),
  ).toBeVisible();
  await expect(editor).toHaveValue("Local work that must not disappear");
  await page.getByRole("button", { name: "Use saved version" }).click();
  await expect(editor).toHaveValue("Saved concurrently on another device");
});
