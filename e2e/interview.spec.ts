import { expect, test } from "@playwright/test";

import type {
  InterviewMessage,
  InterviewSessionWithMessages,
} from "@/contracts/http/v1/interviews";

const authStorageState = process.env.E2E_AUTH_STORAGE_STATE;

test.use({
  storageState: authStorageState ?? { cookies: [], origins: [] },
});

const now = "2026-08-02T12:00:00.000Z";
const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const initial = {
  completedAt: null,
  coverage: {
    academicInterests: false,
    activities: false,
    experiences: 0,
    goals: false,
    responsibilities: false,
    values: false,
    voice: false,
  },
  createdAt: now,
  currentQuestionKey: "ACADEMIC_INTERESTS",
  id: sessionId,
  messages: [
    {
      content: "What subjects keep pulling you back?",
      createdAt: now,
      id: "30000000-0000-4000-8000-000000000001",
      questionKey: "ACADEMIC_INTERESTS",
      role: "ASSISTANT",
      sequence: 0,
      sessionId,
      userId,
    },
  ],
  status: "ACTIVE",
  updatedAt: now,
  userId,
} as InterviewSessionWithMessages;

test("answers by keyboard and resumes only server-confirmed turns after reload", async ({
  page,
}) => {
  test.skip(
    !authStorageState,
    "Set E2E_AUTH_STORAGE_STATE to a current invited-adult Supabase session.",
  );
  let current: InterviewSessionWithMessages = initial;
  await page.route("**/api/v1/interview-sessions/current", (route) =>
    route.fulfill({
      body: JSON.stringify({
        apiVersion: "1",
        data: current,
        meta: { requestId: crypto.randomUUID() },
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route(
    `**/api/v1/interview-sessions/${sessionId}/messages`,
    async (route) => {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      expect(route.request().postDataJSON()).toEqual({
        answer: "Synthetic biology keeps pulling me back.",
        questionKey: "ACADEMIC_INTERESTS",
      });
      const answer = {
        content: "Synthetic biology keeps pulling me back.",
        createdAt: now,
        id: "30000000-0000-4000-8000-000000000002",
        questionKey: "ACADEMIC_INTERESTS",
        role: "USER",
        sequence: 1,
        sessionId,
        userId,
      } as InterviewMessage;
      const nextQuestion = {
        content: "Tell me about a difficult experience.",
        createdAt: now,
        id: "30000000-0000-4000-8000-000000000003",
        questionKey: "EXPERIENCE_CHALLENGE",
        role: "ASSISTANT",
        sequence: 2,
        sessionId,
        userId,
      } as InterviewMessage;
      current = {
        ...initial,
        coverage: { ...initial.coverage, academicInterests: true },
        currentQuestionKey: "EXPERIENCE_CHALLENGE",
        messages: [...initial.messages, answer, nextQuestion],
      };
      await route.fulfill({
        body: JSON.stringify({
          apiVersion: "1",
          data: { answer, nextQuestion, session: current },
          meta: { requestId: crypto.randomUUID() },
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );

  await page.goto("/interview");
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.focus();
  await page.keyboard.type("Synthetic biology keeps pulling me back.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(
    page.getByRole("heading", {
      name: "Tell me about a difficult experience.",
    }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Synthetic biology keeps pulling me back."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Tell me about a difficult experience.",
    }),
  ).toBeVisible();
});
