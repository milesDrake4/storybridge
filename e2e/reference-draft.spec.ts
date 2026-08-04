import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const storageState = resolve(
  process.cwd(),
  "test-results/auth/reference-draft.json",
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

const now = "2026-08-04T13:00:00.000Z";
const userId = "fb000000-0000-4000-8000-000000000001";
const essayId = "fb100000-0000-4000-8000-000000000001";
const proposalId = "fb200000-0000-4000-8000-000000000001";
const claimId = "fb300000-0000-4000-8000-000000000001";
const schoolId = "fb400000-0000-4000-8000-000000000001";
const sourceId = "fb500000-0000-4000-8000-000000000001";
const factId = "fb600000-0000-4000-8000-000000000001";
const contentHmac = `v1.${"c".repeat(43)}`;
const envelope = (data: unknown) => ({
  apiVersion: "1",
  data,
  meta: { requestId: crypto.randomUUID() },
});

test("keeps a reference draft read-only and preserves claim decisions", async ({
  page,
}) => {
  let generated = false;
  let rejected = false;
  const proposal = () => ({
    acknowledgmentVersion: "reference-draft-2026-08-02",
    canAccept: false,
    claims: [
      {
        contentHmac,
        decidedAt: rejected ? now : null,
        decision: rejected ? "REJECTED" : null,
        end: 43,
        evidence: {
          schoolSources: [
            {
              claim: "The school supports community repair partnerships.",
              id: sourceId,
              title: "Community partnerships",
            },
          ],
          storyFacts: [
            {
              id: factId,
              summary: "Organized a neighborhood bicycle repair day.",
            },
          ],
        },
        id: claimId,
        schoolSourceIds: [sourceId],
        start: 0,
        status: "SUPPORTED",
        storyFactIds: [factId],
        text: "I organized a community bicycle repair day.",
      },
    ],
    createdAt: now,
    essayId,
    expiresAt: "2027-08-04T13:00:00.000Z",
    id: proposalId,
    kind: "REFERENCE_DRAFT",
    rationale: "A source-bound example.",
    referenceText: "I organized a community bicycle repair day.",
    status: "PENDING",
    targetRevision: 7,
    userId,
  });
  const essay = {
    createdAt: now,
    dossierId: "fb700000-0000-4000-8000-000000000001",
    draftText: "My student-authored opening remains here.",
    id: essayId,
    outline: {
      schemaVersion: "1",
      sections: [1, 2, 3].map((position) => ({
        id: `fb800000-0000-4000-8000-00000000000${position}`,
        purpose: `Purpose ${position}`,
        schoolSourceIds: [sourceId],
        storyFactIds: [factId],
        targetWords: 100,
      })),
    },
    prompt: "Describe how you will contribute to this campus community.",
    revision: 7,
    schoolId,
    season: "2026-2027",
    selectedAngleId: null,
    status: "DRAFTING",
    updatedAt: now,
    userId,
    wordLimit: 300,
  };

  await page.route(`**/api/v1/essays/${essayId}/reference-draft`, (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({
      acknowledgmentVersion: "reference-draft-2026-08-02",
    });
    generated = true;
    return route.fulfill({ json: envelope(proposal()), status: 201 });
  });
  await page.route(
    `**/api/v1/essays/${essayId}/reference-claim-confirmations/${claimId}`,
    (route) => {
      const request = route.request();
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.postDataJSON()).toEqual({ decision: "REJECT" });
      rejected = true;
      return route.fulfill({
        json: envelope({
          claimContentHmac: contentHmac,
          claimId,
          decidedAt: now,
          decision: "REJECTED",
          essayId,
          userId,
        }),
      });
    },
  );
  await page.route(`**/api/v1/essays/${essayId}`, (route) =>
    route.fulfill({
      json: envelope({
        essay,
        referenceDraft: generated ? proposal() : null,
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
  const panel = page.getByRole("region", {
    name: "AI reference draft — read only",
  });
  const generate = panel.getByRole("button", {
    name: "Generate my one reference draft",
  });
  await expect(generate).toBeDisabled();
  await panel
    .getByRole("checkbox", { name: /I understand this is an AI/i })
    .check();
  await generate.click();

  await expect(panel.getByLabel("AI reference draft")).toHaveText(
    "I organized a community bicycle repair day.",
  );
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(
    panel.getByText(/neighborhood bicycle repair day/i),
  ).toBeVisible();
  await expect(panel.getByText(/community partnerships/i)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /accept|copy|insert|export/i }),
  ).toHaveCount(0);

  await panel.getByRole("button", { name: "Reject claim" }).click();
  await expect(panel.getByRole("status")).toContainText("Rejected");
  await expect(panel.getByRole("button", { name: "Reject claim" })).toHaveCount(
    0,
  );
  await expect(
    panel.getByRole("button", { name: "Confirm claim" }),
  ).toHaveCount(0);

  await page.reload();
  const reloadedPanel = page.getByRole("region", {
    name: "AI reference draft — read only",
  });
  await expect(reloadedPanel.getByRole("status")).toContainText("Rejected");
  await expect(reloadedPanel.getByLabel("AI reference draft")).toBeVisible();
});
