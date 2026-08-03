import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const generatedStorageState = resolve(
  process.cwd(),
  "test-results/auth/essay-setup.json",
);
const authStorageState =
  process.env.E2E_AUTH_STORAGE_STATE ?? generatedStorageState;
let cleanup: (() => Promise<void>) | undefined;

test.use({ storageState: authStorageState });

test.beforeAll(async () => {
  if (process.env.E2E_AUTH_STORAGE_STATE) return;
  cleanup = await prepareLocalInvitedAdultStorageState({
    appUrl: new URL("http://127.0.0.1:3100"),
    path: generatedStorageState,
  });
});

test.afterAll(async () => {
  await cleanup?.();
});

const now = "2026-08-03T16:00:00.000Z";
const essayId = "f2000000-0000-4000-8000-000000000001";
const school = {
  canonicalName: "University of Michigan",
  id: "f1000000-0000-4000-8000-000000000001",
  officialDomain: "umich.edu",
};
const prompt = "Describe a community that has shaped your perspective.";
const workspace = {
  essay: {
    createdAt: now,
    dossierId: null,
    id: essayId,
    outline: null,
    prompt,
    revision: 0,
    schoolId: school.id,
    selectedAngleId: null,
    season: "2026-2027",
    status: "STRATEGY",
    updatedAt: now,
    userId: "f0000000-0000-4000-8000-000000000001",
    wordLimit: 300,
  },
  school,
};

function envelope(data: unknown) {
  return {
    apiVersion: "1",
    data,
    meta: { requestId: crypto.randomUUID() },
  };
}

test("creates and reopens an essay using only a registry school name", async ({
  page,
}) => {
  await page.route("**/api/v1/schools?**", (route) =>
    route.fulfill({ json: envelope({ items: [school], nextCursor: null }) }),
  );
  await page.route("**/api/v1/essays**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.postDataJSON()).toEqual({
        prompt,
        schoolId: school.id,
        wordLimit: 300,
      });
      expect(request.postData()).not.toContain(school.officialDomain);
      await route.fulfill({ json: envelope(workspace), status: 201 });
      return;
    }
    if (url.pathname.endsWith("/research")) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (url.pathname === `/api/v1/essays/${essayId}`) {
      await route.fulfill({ json: envelope(workspace) });
      return;
    }
    await route.fulfill({
      json: envelope({
        items: [
          {
            createdAt: now,
            id: essayId,
            school,
            status: "STRATEGY",
            updatedAt: now,
            wordLimit: 300,
          },
        ],
        nextCursor: null,
      }),
    });
  });

  await page.goto("/essays/new");
  await page.getByRole("searchbox", { name: "Search schools" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.getByLabel("Official application prompt").fill(prompt);
  await page.getByLabel("Word limit").fill("300");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page).toHaveURL(`/essays/${essayId}`);
  await expect(
    page.getByRole("heading", { name: school.canonicalName }),
  ).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  await page.goto("/essays");
  await page.getByRole("link", { name: "Open essay" }).click();
  await expect(page).toHaveURL(`/essays/${essayId}`);
  await expect(page.getByText(prompt)).toBeVisible();
});

test("preserves personal prose while explaining how to recover safely", async ({
  page,
}) => {
  let createRequests = 0;
  await page.route("**/api/v1/schools?**", (route) =>
    route.fulfill({ json: envelope({ items: [school], nextCursor: null }) }),
  );
  await page.route("**/api/v1/essays", (route) => {
    createRequests += 1;
    return route.abort();
  });

  await page.goto("/essays/new");
  await page
    .getByRole("button", { name: new RegExp(school.canonicalName) })
    .click();
  const promptField = page.getByLabel("Official application prompt");
  const personalDraft =
    "Here is my essay draft: I grew up translating for my parents.";
  await promptField.fill(personalDraft);
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Paste only the school's official prompt",
  );
  await expect(promptField).toHaveValue(personalDraft);
  expect(createRequests).toBe(0);
});
