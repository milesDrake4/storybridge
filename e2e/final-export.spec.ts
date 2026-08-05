import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(
  process.cwd(),
  "test-results/auth/final-export.json",
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

const now = "2026-08-04T22:00:00.000Z";
const userId = "fa000000-0000-4000-8000-000000000001";
const essayId = "fa100000-0000-4000-8000-000000000001";
const schoolId = "fa200000-0000-4000-8000-000000000001";
const sourceId = "fa300000-0000-4000-8000-000000000001";
const factId = "fa400000-0000-4000-8000-000000000001";
const studentDraft =
  "Repairing bicycles with my neighbors taught me to listen before leading.";
const referenceDraft =
  "This AI reference content must never appear in clipboard or download output.";
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("reviews and exports only the current student-authored draft", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const essay = {
    createdAt: now,
    dossierId: "fa500000-0000-4000-8000-000000000001",
    draftText: studentDraft,
    id: essayId,
    outline: {
      schemaVersion: "1",
      sections: [1, 2, 3].map((position) => ({
        id: `fa600000-0000-4000-8000-00000000000${position}`,
        purpose: `Purpose ${position}`,
        schoolSourceIds: [sourceId],
        storyFactIds: [factId],
        targetWords: 100,
      })),
    },
    prompt: "Describe how you will contribute to this campus community.",
    revision: 9,
    schoolId,
    season: "2026-2027",
    selectedAngleId: null,
    status: "REVIEWING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  };

  await page.route(`**/api/v1/essays/${essayId}`, (route) =>
    route.fulfill({
      json: envelope({
        essay,
        referenceDraft: null,
        school: {
          canonicalName: "University of Michigan",
          id: schoolId,
          officialDomain: "umich.edu",
        },
      }),
    }),
  );
  await page.route(`**/api/v1/essays/${essayId}/research`, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route(`**/api/v1/essays/${essayId}/angles`, (route) =>
    route.fulfill({ json: envelope({ angles: [] }) }),
  );
  await page.route(`**/api/v1/essays/${essayId}/audits`, (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({
      json: envelope({
        createdAt: now,
        essayId,
        essayRevision: 9,
        evidenceManifestVersion: `v1.${"a".repeat(43)}`,
        id: "fa700000-0000-4000-8000-000000000001",
        issues: [],
        similarity: {
          distinctReferenceFourGramCount: 12,
          fourGramOverlapRatio: 0,
          longestContiguousMatch: 0,
          matchedReferenceFourGramCount: 0,
          referenceTokenCount: 15,
          studentTokenCount: 11,
          substantiallySimilar: false,
          thresholdCode: "BELOW_THRESHOLD",
        },
        status: "PASS",
        userId,
      }),
      status: 201,
    });
  });
  await page.route(`**/api/v1/essays/${essayId}/export.txt`, (route) =>
    route.fulfill({
      body: studentDraft,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
      },
      status: 200,
    }),
  );

  await page.goto(`/essays/${essayId}`);
  const review = page.getByRole("region", { name: "Final review and export" });
  await expect(review.getByText(/institution.?s AI policy/i)).toBeVisible();
  await review.getByRole("button", { name: "Run final review" }).click();
  await expect(review.getByRole("status")).toContainText("Ready to export");

  await review.getByRole("button", { name: "Copy student draft" }).click();
  await expect(review.getByText("Student draft copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    studentDraft,
  );

  const downloadPromise = page.waitForEvent("download");
  await review.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("storybridge-essay.txt");
  const stream = await download.createReadStream();
  let downloaded = "";
  for await (const chunk of stream) downloaded += chunk.toString();
  expect(downloaded).toBe(studentDraft);
  expect(downloaded).not.toContain(referenceDraft);
});
