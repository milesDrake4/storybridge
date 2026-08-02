import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InterviewFlow } from "@/components/interview/interview-flow";
import type { InterviewSessionWithMessages } from "@/contracts/http/v1/interviews";

const now = "2026-08-02T12:00:00.000Z";
const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const initialSession = {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function apiSuccess(data: unknown, status = 201) {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      data,
      meta: { requestId: "90000000-0000-4000-8000-000000000001" },
    }),
    { status },
  );
}

function nextTurn() {
  return {
    answer: {
      content: "Synthetic biology keeps pulling me back.",
      createdAt: now,
      id: "30000000-0000-4000-8000-000000000002",
      questionKey: "ACADEMIC_INTERESTS",
      role: "USER",
      sequence: 1,
      sessionId,
      userId,
    },
    nextQuestion: {
      content: "Tell me about a difficult experience.",
      createdAt: now,
      id: "30000000-0000-4000-8000-000000000003",
      questionKey: "EXPERIENCE_CHALLENGE",
      role: "ASSISTANT",
      sequence: 2,
      sessionId,
      userId,
    },
    session: {
      ...initialSession,
      coverage: {
        ...initialSession.coverage,
        academicInterests: true,
      },
      currentQuestionKey: "EXPERIENCE_CHALLENGE",
      messages: undefined,
    },
  };
}

describe("resumable interview flow", () => {
  it("reloads the owned transcript and resumes at the server's current question", async () => {
    const resumed = {
      ...initialSession,
      messages: [
        initialSession.messages[0],
        {
          ...nextTurn().answer,
          content: "A saved answer from an earlier visit.",
        },
        nextTurn().nextQuestion,
      ],
      currentQuestionKey: "EXPERIENCE_CHALLENGE",
    } as InterviewSessionWithMessages;
    const fetchMock = vi.fn().mockResolvedValue(apiSuccess(resumed, 200));
    vi.stubGlobal("fetch", fetchMock);

    render(<InterviewFlow />);

    expect(
      await screen.findByRole("heading", {
        name: "Tell me about a difficult experience.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("A saved answer from an earlier visit."),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/interview-sessions/current",
      { cache: "no-store" },
    );
  });

  it("does not mark or render an answer as saved before the server confirms its sequence", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<InterviewFlow initialSession={initialSession} />);
    await user.type(
      screen.getByRole("textbox", { name: "Your answer" }),
      "Synthetic biology keeps pulling me back.",
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(
      screen.queryByText("Synthetic biology keeps pulling me back.", {
        selector: ".interview-transcript *",
      }),
    ).not.toBeInTheDocument();

    resolveRequest(apiSuccess(nextTurn()));
    await screen.findByRole("heading", {
      name: "Tell me about a difficult experience.",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(
      screen.getByText("Synthetic biology keeps pulling me back."),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/interview-sessions/${sessionId}/messages`,
      expect.objectContaining({
        body: JSON.stringify({
          answer: "Synthetic biology keeps pulling me back.",
          questionKey: "ACADEMIC_INTERESTS",
        }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
  });

  it("keeps prior answers and the current draft during supportive safety recovery", async () => {
    const resumed = {
      ...initialSession,
      messages: [
        initialSession.messages[0],
        {
          ...nextTurn().answer,
          content: "A previously saved answer.",
        },
        nextTurn().nextQuestion,
      ],
      currentQuestionKey: "EXPERIENCE_CHALLENGE",
    } as InterviewSessionWithMessages;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: "1",
            error: {
              code: "VALIDATION_ERROR",
              fieldErrors: [{ code: "SELF_HARM", path: "answer" }],
              message: "The request contains invalid values.",
              retryable: false,
            },
            meta: { requestId: "90000000-0000-4000-8000-000000000001" },
          }),
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();

    render(<InterviewFlow initialSession={resumed} />);
    const answer = screen.getByRole("textbox", { name: "Your answer" });
    await user.type(answer, "Synthetic safety fixture");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your wellbeing matters more than this interview",
    );
    expect(screen.getByText("A previously saved answer.")).toBeVisible();
    expect(answer).toHaveValue("Synthetic safety fixture");
    expect(
      screen.getByRole("heading", {
        name: "Tell me about a difficult experience.",
      }),
    ).toBeVisible();
  });

  it("shows an explicit conflict state and preserves the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: "1",
            error: {
              code: "STATE_CONFLICT",
              message: "The request conflicts with the current resource state.",
              retryable: false,
            },
            meta: { requestId: "90000000-0000-4000-8000-000000000001" },
          }),
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();

    render(<InterviewFlow initialSession={initialSession} />);
    const answer = screen.getByRole("textbox", { name: "Your answer" });
    await user.type(answer, "A conflicting answer");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Conflict");
    expect(answer).toHaveValue("A conflicting answer");
    expect(
      screen.getByRole("button", { name: "Reload latest question" }),
    ).toBeVisible();
  });
});
