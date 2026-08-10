import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(
  process.cwd(),
  "test-results/auth/account-privacy.json",
);
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

const now = "2026-08-10T18:00:00.000Z";
const deletionId = "ff100000-0000-4000-8000-000000000001";
const statusToken = `dst_v1_${"a".repeat(43)}`;
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("downloads private data and preserves one-time deletion status access", async ({
  page,
}) => {
  await page.route("**/api/v1/me/export**", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: { essays: [] },
        exportedAt: now,
        profile: { display_name: "Student" },
        schemaVersion: "2026-08-10",
      }),
      headers: {
        "content-disposition":
          'attachment; filename="storybridge-data-2026-08-10.json"',
        "content-type": "application/json",
      },
    }),
  );
  await page.route("**/api/v1/me", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ confirmation: "DELETE" });
    await route.fulfill({
      json: envelope({ deletionId, status: "QUEUED", statusToken }),
      status: 202,
    });
  });
  await page.route("**/api/v1/me/deletion", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `DeletionStatus ${statusToken}`,
    );
    await route.fulfill({
      json: envelope({
        completedAt: now,
        deletionId,
        requestedAt: now,
        status: "COMPLETE",
      }),
    });
  });

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Keep your data in your hands." }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("storybridge-data-2026-08-10.json");

  await page.getByLabel("Confirmation").fill("DELETE");
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  await expect(page.getByLabel("Deletion status token")).toHaveText(
    statusToken,
  );
  await expect(page.getByText(/all sessions are signed out/i)).toBeVisible();

  await page.getByRole("button", { name: "Check deletion status" }).click();
  await expect(
    page.getByText("Your account deletion is complete."),
  ).toBeVisible();
});
