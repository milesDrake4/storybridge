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
const proposalId = "fa700000-0000-4000-8000-000000000001";
const claimId = "fa800000-0000-4000-8000-000000000001";
const initialDraft = "I am still deciding how to tell this story.";
const studentDraft =
  "Repairing bicycles with my neighbors taught me to listen before leading.";
const referenceDraft =
  "I organized a bicycle repair event and learned to lead my community.";
const contentHmac = `v1.${"c".repeat(43)}`;
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
  let draftText = initialDraft;
  let revision = 9;
  let generated = false;
  let confirmed = false;
  const essay = () => ({
    createdAt: now,
    dossierId: "fa500000-0000-4000-8000-000000000001",
    draftText,
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
    revision,
    schoolId,
    season: "2026-2027",
    selectedAngleId: null,
    status: "REVIEWING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  });
  const proposal = () => ({
    acknowledgmentVersion: "reference-draft-2026-08-02",
    canAccept: false,
    claims: [
      {
        contentHmac,
        decidedAt: confirmed ? now : null,
        decision: confirmed ? "CONFIRMED" : null,
        end: referenceDraft.length,
        evidence: {
          schoolSources: [
            {
              claim: "The school supports collaborative community projects.",
              id: sourceId,
              title: "Community partnerships",
            },
          ],
          storyFacts: [
            {
              id: factId,
              summary: "Organized a neighborhood bicycle repair event.",
            },
          ],
        },
        id: claimId,
        schoolSourceIds: [sourceId],
        start: 0,
        status: "SUPPORTED",
        storyFactIds: [factId],
        text: referenceDraft,
      },
    ],
    createdAt: now,
    essayId,
    expiresAt: "2027-08-04T22:00:00.000Z",
    id: proposalId,
    kind: "REFERENCE_DRAFT",
    rationale: "A source-bound example for structural reference only.",
    referenceText: referenceDraft,
    status: "PENDING",
    targetRevision: 9,
    userId,
  });

  await page.route(`**/api/v1/essays/${essayId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["if-match"]).toBe(
        `"essay:${essayId}:r${revision}"`,
      );
      draftText = route.request().postDataJSON().draftText;
      revision += 1;
      await route.fulfill({ json: envelope(essay()) });
      return;
    }
    await route.fulfill({
      json: envelope({
        essay: essay(),
        referenceDraft: generated ? proposal() : null,
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
  await page.route(`**/api/v1/essays/${essayId}/reference-draft`, (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    generated = true;
    return route.fulfill({ json: envelope(proposal()), status: 201 });
  });
  await page.route(
    `**/api/v1/essays/${essayId}/reference-claim-confirmations/${claimId}`,
    (route) => {
      expect(route.request().postDataJSON()).toEqual({ decision: "CONFIRM" });
      confirmed = true;
      return route.fulfill({
        json: envelope({
          claimContentHmac: contentHmac,
          claimId,
          decidedAt: now,
          decision: "CONFIRMED",
          essayId,
          userId,
        }),
      });
    },
  );
  await page.route(`**/api/v1/essays/${essayId}/audits`, (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({
      json: envelope({
        createdAt: now,
        essayId,
        essayRevision: revision,
        evidenceManifestVersion: `v1.${"a".repeat(43)}`,
        id: "fa900000-0000-4000-8000-000000000001",
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
  const reference = page.getByRole("region", {
    name: "AI reference draft — read only",
  });
  await reference
    .getByRole("checkbox", { name: /I understand this is an AI/i })
    .check();
  await reference
    .getByRole("button", { name: "Generate my one reference draft" })
    .click();
  await expect(reference.getByLabel("AI reference draft")).toHaveText(
    referenceDraft,
  );
  await reference.getByRole("button", { name: "Confirm claim" }).click();
  await expect(reference.getByRole("status")).toContainText("Confirmed");

  const editor = page.getByRole("textbox", { name: "Essay draft" });
  await editor.fill(studentDraft);
  await editor.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(revision).toBe(10);

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
