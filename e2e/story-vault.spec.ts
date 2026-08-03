import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { prepareLocalInvitedAdultStorageState } from "./support/local-supabase";

const generatedStorageState = resolve(
  process.cwd(),
  "test-results/auth/story-vault.json",
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

test("reviews sources and applies explicit fact privacy controls", async ({
  page,
}) => {
  const now = "2026-08-02T20:00:00.000Z";
  const factId = "e2000000-0000-4000-8000-000000000001";
  const profileId = "e1000000-0000-4000-8000-000000000001";
  let fact = {
    category: "VALUES",
    contentHmac: "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    createdAt: now,
    details: ["Chooses careful, evidence-based work"],
    id: factId,
    profileId,
    revision: 1,
    sourceMessageIds: ["e3000000-0000-4000-8000-000000000001"],
    sources: [
      {
        content: "I value careful work.",
        id: "e3000000-0000-4000-8000-000000000001",
        questionKey: "VALUES",
      },
    ],
    summary: "Values careful work",
    suppressedAt: null as string | null,
    updatedAt: now,
    userId: "e0000000-0000-4000-8000-000000000001",
    verificationStatus: "UNVERIFIED",
    verifiedAt: null as string | null,
  };
  const profile = {
    createdAt: now,
    excludedTopics: [],
    id: profileId,
    revision: 1,
    sourceSessionId: "e4000000-0000-4000-8000-000000000001",
    status: "REVIEW_REQUIRED",
    updatedAt: now,
    userId: fact.userId,
    version: 1,
    voiceProfile: {
      sentenceStyle: "Direct",
      toneTraits: ["reflective"],
      vocabulary: "Concrete",
    },
  };
  const envelope = (data: unknown) => ({
    apiVersion: "1",
    data,
    meta: { requestId: crypto.randomUUID() },
  });
  await page.route("**/api/v1/story-profile", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: envelope({ facts: [fact], profile }) });
      return;
    }
    await route.continue();
  });
  await page.route(
    `**/api/v1/story-facts/${factId}/verification`,
    async (route) => {
      expect(route.request().headers()["if-match"]).toBe(`"fact:${factId}:r1"`);
      fact = {
        ...fact,
        revision: 2,
        verificationStatus: "VERIFIED",
        verifiedAt: now,
      };
      await route.fulfill({ json: envelope(fact) });
    },
  );
  await page.route(
    `**/api/v1/story-facts/${factId}/suppression`,
    async (route) => {
      fact = { ...fact, revision: 3, suppressedAt: now };
      await route.fulfill({ json: envelope(fact) });
    },
  );

  await page.goto("/story-vault");
  await page.getByText("View 1 interview source").click();
  await expect(page.getByText("I value careful work.")).toBeVisible();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide from AI" }).click();
  await expect(
    page.getByRole("button", { name: "Restore to AI" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("verified", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore to AI" }),
  ).toBeVisible();
});
