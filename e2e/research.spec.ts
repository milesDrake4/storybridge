import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const generatedStorageState = resolve(
  process.cwd(),
  "test-results/auth/research.json",
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
test.afterAll(async () => cleanup?.());

const now = "2026-08-03T18:00:00.000Z";
const essayId = "b1000000-0000-4000-8000-000000000001";
const schoolId = "b2000000-0000-4000-8000-000000000001";
const userId = "b0000000-0000-4000-8000-000000000001";
const workspace = {
  essay: {
    createdAt: now,
    dossierId: null,
    id: essayId,
    prompt: "Describe a community that has shaped your perspective.",
    revision: 0,
    schoolId,
    season: "2026-2027",
    status: "STRATEGY",
    updatedAt: now,
    userId,
    wordLimit: 300,
  },
  school: {
    canonicalName: "University of Michigan",
    id: schoolId,
    officialDomain: "umich.edu",
  },
};
const dossier = {
  createdAt: now,
  essayId,
  id: "b3000000-0000-4000-8000-000000000001",
  schemaVersion: "1",
  schoolId,
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
  userId,
};

const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("runs research and exposes complete citation provenance", async ({
  page,
}) => {
  let saved = false;
  await page.route(`**/api/v1/essays/${essayId}`, (route) =>
    route.fulfill({ json: envelope(workspace) }),
  );
  await page.route(`**/api/v1/essays/${essayId}/research`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(
        saved ? { json: envelope(dossier) } : { status: 404 },
      );
      return;
    }
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    saved = true;
    await route.fulfill({ json: envelope(dossier), status: 201 });
  });

  await page.goto(`/essays/${essayId}`);
  await page.getByRole("button", { name: "Research this school" }).click();

  await expect(page.getByText("academics", { exact: true })).toBeVisible();
  await expect(
    page.getByText(dossier.sources[0].supportingExcerpt),
  ).toBeVisible();
  await expect(page.getByText(/Retrieved Aug 3, 2026/)).toBeVisible();
  const citation = page.getByRole("link", { name: /Academics at Michigan/ });
  await expect(citation).toHaveAttribute("href", "https://umich.edu/academics");
  await expect(citation).toHaveAttribute("target", "_blank");

  await page.reload();
  await expect(page.getByText(dossier.sources[0].claim)).toBeVisible();
});
