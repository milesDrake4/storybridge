import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(process.cwd(), "test-results/auth/rewrite.json");
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

const now = "2026-08-04T00:00:00.000Z";
const userId = "ca000000-0000-4000-8000-000000000001";
const essayId = "ca100000-0000-4000-8000-000000000001";
const proposalId = "ca200000-0000-4000-8000-000000000001";
const schoolId = "ca300000-0000-4000-8000-000000000001";
const sourceId = "ca400000-0000-4000-8000-000000000001";
const factId = "ca500000-0000-4000-8000-000000000001";
const outline = {
  schemaVersion: "1",
  sections: [1, 2, 3].map((position) => ({
    id: `ca600000-0000-4000-8000-00000000000${position}`,
    purpose: `Purpose ${position}`,
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    targetWords: 100,
  })),
};
const draftText = "I repaired bicycles with neighbors.";
const selectedText = "repaired bicycles";
const start = draftText.indexOf(selectedText);
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("previews an exact rewrite and applies it only after acceptance", async ({
  page,
}) => {
  let revision = 7;
  let savedText = draftText;
  const essay = () => ({
    createdAt: now,
    dossierId: "ca700000-0000-4000-8000-000000000001",
    draftText: savedText,
    id: essayId,
    outline,
    prompt: "Describe how you will contribute to this campus community.",
    revision,
    schoolId,
    season: "2026-2027",
    selectedAngleId: null,
    status: "DRAFTING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  });
  await page.route(`**/api/v1/essays/${essayId}/rewrite-proposals`, (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toMatchObject({
      instruction: "CLARIFY",
      selection: { end: start + selectedText.length, start },
    });
    return route.fulfill({
      json: envelope({
        canAccept: true,
        claims: [],
        createdAt: now,
        essayId,
        expiresAt: "2027-08-04T00:00:00.000Z",
        id: proposalId,
        instruction: "CLARIFY",
        kind: "REWRITE",
        proposedText: "fixed bikes",
        rationale: "This is more direct.",
        selection: {
          end: start + selectedText.length,
          start,
          textHash: request.postDataJSON().selection.textHash,
        },
        status: "PENDING",
        targetRevision: 7,
        userId,
      }),
      status: 201,
    });
  });
  await page.route(
    `**/api/v1/essays/${essayId}/proposals/${proposalId}/accept`,
    (route) => {
      expect(route.request().headers()["if-match"]).toBe(
        `"essay:${essayId}:r7"`,
      );
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 7 });
      savedText = "I fixed bikes with neighbors.";
      revision = 8;
      return route.fulfill({ json: envelope(essay()) });
    },
  );
  await page.route(`**/api/v1/essays/${essayId}`, (route) =>
    route.fulfill({
      json: envelope({
        essay: essay(),
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

  await page.goto(`/essays/${essayId}`);
  const editor = page.getByRole("textbox", { name: "Essay draft" });
  await expect(editor).toHaveValue(draftText);
  await editor.click();
  await editor.press("Home");
  for (let offset = 0; offset < start; offset += 1) {
    await editor.press("ArrowRight");
  }
  await page.keyboard.down("Shift");
  for (let offset = 0; offset < selectedText.length; offset += 1) {
    await editor.press("ArrowRight");
  }
  await page.keyboard.up("Shift");
  const generate = page.getByRole("button", { name: "Generate preview" });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(
    page.getByRole("heading", { name: "Proposed rewrite" }),
  ).toBeVisible();
  await expect(page.getByText(selectedText)).toBeVisible();
  await expect(page.getByText("fixed bikes")).toBeVisible();
  await expect(editor).toHaveValue(draftText);
  await page.getByRole("button", { name: "Accept this change" }).click();
  await expect(editor).toHaveValue("I fixed bikes with neighbors.");
});
