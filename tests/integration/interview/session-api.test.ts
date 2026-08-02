import { describe, expect, it, vi } from "vitest";

import {
  createCurrentInterviewGetHandler,
  createInterviewAnswerPostHandler,
  createInterviewStartPostHandler,
} from "@/app/api/v1/interview-sessions/handler";
import type {
  AiOperationId,
  InterviewSessionId,
  UserId,
} from "@/contracts/domain/ids";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import {
  interviewSessionSchema,
  interviewSessionWithMessagesSchema,
  interviewTurnSchema,
  type InterviewSession,
} from "@/contracts/http/v1/interviews";
import type { InterviewRepository } from "@/repositories/interview-repository";
import { InterviewSequenceError } from "@/repositories/interview-repository";
import {
  answerInterview,
  getCurrentInterview,
  InterviewError,
  startInterview,
} from "@/services/interview/interview-service";

const appUrl = new URL("https://storybridge.test");
const now = new Date("2026-08-02T12:00:00Z");
const userId = "10000000-0000-4000-8000-000000000001" as UserId;
const sessionId = "20000000-0000-4000-8000-000000000001" as InterviewSessionId;
const operationId = "21000000-0000-4000-8000-000000000001" as AiOperationId;
const answerId = "30000000-0000-4000-8000-000000000001";
const nextId = "30000000-0000-4000-8000-000000000002";
const coverage = {
  academicInterests: false,
  activities: false,
  experiences: 0,
  goals: false,
  responsibilities: false,
  values: false,
  voice: false,
};
const session: InterviewSession = {
  completedAt: null,
  coverage,
  createdAt: now.toISOString(),
  currentQuestionKey: "ACADEMIC_INTERESTS",
  id: sessionId,
  status: "ACTIVE",
  updatedAt: now.toISOString(),
  userId,
};
const firstQuestion = {
  content:
    "What subjects or questions keep pulling you back, even when no one assigns them?",
  createdAt: now.toISOString(),
  id: nextId,
  questionKey: "ACADEMIC_INTERESTS" as const,
  role: "ASSISTANT" as const,
  sequence: 0,
  sessionId,
  userId,
};
const turn = {
  answer: {
    content: "I keep returning to synthetic biology.",
    createdAt: now.toISOString(),
    id: answerId,
    questionKey: "ACADEMIC_INTERESTS" as const,
    role: "USER" as const,
    sequence: 1,
    sessionId,
    userId,
  },
  nextQuestion: {
    content: "Tell me about a difficult experience.",
    createdAt: now.toISOString(),
    id: nextId,
    questionKey: "EXPERIENCE_CHALLENGE" as const,
    role: "ASSISTANT" as const,
    sequence: 2,
    sessionId,
    userId,
  },
  session: {
    ...session,
    coverage: { ...coverage, academicInterests: true },
    currentQuestionKey: "EXPERIENCE_CHALLENGE" as const,
  },
};

function repository(
  overrides: Partial<InterviewRepository> = {},
): InterviewRepository {
  return {
    getCurrent: vi.fn().mockResolvedValue({
      ...session,
      messages: [firstQuestion],
    }),
    getTurn: vi.fn().mockResolvedValue(turn),
    recordAnswer: vi.fn().mockResolvedValue(turn),
    start: vi.fn().mockResolvedValue(session),
    ...overrides,
  };
}

function serviceDependencies(interviews = repository()) {
  return {
    aiOperations: {
      finalize: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      reserve: vi.fn().mockResolvedValue({
        operationId,
        resetAt: new Date("2026-08-03T00:00:00Z"),
        type: "RESERVED" as const,
      }),
      start: vi.fn().mockResolvedValue("STARTED" as const),
    },
    hmacSecrets: {
      content: "test-content-hmac-secret-00000000002",
      idempotency: "test-idempotency-hmac-secret-000003",
      ip: "test-ip-hmac-secret-000000000000001",
    },
    interviews,
    limits: {
      betaAccountCap: 25,
      dailyAiCallLimit: 50,
      monthlyOpenAiBudgetCents: 15_000,
    },
    moderation: {
      check: vi.fn().mockResolvedValue({
        categories: [],
        flagged: false,
        model: "omni-moderation-latest",
        requestId: "modr_synthetic_safe",
        scores: {},
      }),
    },
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          createdAt: now.toISOString(),
          displayName: null,
          onboardingState: "NOT_STARTED" as const,
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
          updatedAt: now.toISOString(),
          userId,
        },
      }),
      recordConsent: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

function jsonRequest(path: string, body: unknown, origin = appUrl.origin) {
  return new Request(new URL(path, appUrl), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: appUrl.host,
      "idempotency-key": "synthetic-test-key-0001",
      origin,
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

describe("interview session service", () => {
  it("starts one server-owned active session and resumes its ordered transcript", async () => {
    const deps = serviceDependencies();

    await expect(startInterview(deps, now)).resolves.toEqual(session);
    await expect(getCurrentInterview(deps, now)).resolves.toEqual({
      ...session,
      messages: [firstQuestion],
    });
    expect(deps.interviews.start).toHaveBeenCalledWith(userId, now);
    expect(deps.interviews.getCurrent).toHaveBeenCalledWith(userId);
  });

  it("moderates normalized input before assigning the answer server-side", async () => {
    const deps = serviceDependencies();

    await expect(
      answerInterview(
        sessionId,
        {
          answer: "  I keep returning to synthetic biology.\r\n",
          questionKey: "ACADEMIC_INTERESTS",
        },
        {
          idempotencyKey: "synthetic-test-key-0001",
          ipAddress: "203.0.113.8",
        },
        deps,
        now,
      ),
    ).resolves.toEqual(turn);

    expect(deps.moderation.check).toHaveBeenCalledWith({
      content: ["I keep returning to synthetic biology."],
      purpose: "INTERVIEW_REPLY",
      userId,
    });
    expect(deps.interviews.recordAnswer).toHaveBeenCalledWith({
      answer: "I keep returning to synthetic biology.",
      now,
      questionKey: "ACADEMIC_INTERESTS",
      sessionId,
      userId,
    });
    expect(deps.moderation.check.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.interviews.recordAnswer).mock.invocationCallOrder[0],
    );
    expect(deps.aiOperations.reserve).toHaveBeenCalledOnce();
    expect(deps.aiOperations.start).toHaveBeenCalledWith(operationId, now);
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        resource: { id: answerId, type: "INTERVIEW_TURN" },
        status: "SUCCEEDED",
      }),
    );
  });

  it("returns the persisted turn for a same-key, same-body replay without another provider call", async () => {
    const deps = serviceDependencies();
    deps.aiOperations.reserve.mockResolvedValue({
      operationId,
      originalHttpStatus: 201,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      resource: { id: answerId, type: "INTERVIEW_TURN" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });

    await expect(
      answerInterview(
        sessionId,
        {
          answer: "I keep returning to synthetic biology.",
          questionKey: "ACADEMIC_INTERESTS",
        },
        {
          idempotencyKey: "synthetic-test-key-0001",
          ipAddress: "203.0.113.8",
        },
        deps,
        now,
      ),
    ).resolves.toEqual(turn);
    expect(deps.interviews.getTurn).toHaveBeenCalledWith(userId, answerId);
    expect(deps.moderation.check).not.toHaveBeenCalled();
    expect(deps.interviews.recordAnswer).not.toHaveBeenCalled();
  });

  it.each(["sexual/minors", "self-harm/intent"])(
    "does not persist an answer flagged for %s",
    async (category) => {
      const deps = serviceDependencies();
      deps.moderation.check.mockResolvedValue({
        categories: [category],
        flagged: true,
        model: "omni-moderation-latest",
        requestId: "modr_synthetic_flagged",
        scores: { [category]: 0.99 },
      });

      await expect(
        answerInterview(
          sessionId,
          {
            answer: "Synthetic unsafe fixture",
            questionKey: "ACADEMIC_INTERESTS",
          },
          {
            idempotencyKey: "synthetic-test-key-0001",
            ipAddress: "203.0.113.8",
          },
          deps,
          now,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(deps.interviews.recordAnswer).not.toHaveBeenCalled();
    },
  );

  it("maps replayed or out-of-order questions to a state conflict", async () => {
    const interviews = repository({
      recordAnswer: vi.fn().mockRejectedValue(new InterviewSequenceError()),
    });

    await expect(
      answerInterview(
        sessionId,
        { answer: "Replay", questionKey: "ACADEMIC_INTERESTS" },
        {
          idempotencyKey: "synthetic-test-key-0001",
          ipAddress: "203.0.113.8",
        },
        serviceDependencies(interviews),
        now,
      ),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("uses the same not-found failure for absent and non-owned session IDs", async () => {
    const interviews = repository({
      recordAnswer: vi.fn().mockResolvedValue(null),
    });

    await expect(
      answerInterview(
        sessionId,
        { answer: "Synthetic answer", questionKey: "ACADEMIC_INTERESTS" },
        {
          idempotencyKey: "synthetic-test-key-0001",
          ipAddress: "203.0.113.8",
        },
        serviceDependencies(interviews),
        now,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

describe("interview session HTTP API", () => {
  it("creates and returns a resumable session with canonical envelopes", async () => {
    const startResponse = await createInterviewStartPostHandler({
      appUrl,
      start: vi.fn().mockResolvedValue(session),
    })(jsonRequest("/api/v1/interview-sessions", {}));
    const currentResponse = await createCurrentInterviewGetHandler({
      current: vi.fn().mockResolvedValue({
        ...session,
        messages: [firstQuestion],
      }),
    })();

    expect(startResponse.status).toBe(201);
    expect(
      apiSuccessSchema(interviewSessionSchema).parse(await startResponse.json())
        .data,
    ).toEqual(session);
    expect(currentResponse.status).toBe(200);
    expect(
      apiSuccessSchema(interviewSessionWithMessagesSchema).parse(
        await currentResponse.json(),
      ).data.messages,
    ).toEqual([firstQuestion]);
  });

  it("rejects unknown question keys before invoking the answer service", async () => {
    const answer = vi.fn();
    const response = await createInterviewAnswerPostHandler({ appUrl, answer })(
      jsonRequest(`/api/v1/interview-sessions/${sessionId}/messages`, {
        answer: "Synthetic answer",
        questionKey: "CALLER_CONTROLLED_QUESTION",
      }),
      sessionId,
    );

    expect(response.status).toBe(422);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );
    expect(answer).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before starting a mutation", async () => {
    const start = vi.fn();
    const request = jsonRequest("/api/v1/interview-sessions", {});
    request.headers.delete("idempotency-key");
    const response = await createInterviewStartPostHandler({ appUrl, start })(
      request,
    );

    expect(response.status).toBe(428);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("returns the canonical turn and maps invalid session IDs to opaque 404s", async () => {
    const answer = vi.fn().mockResolvedValue(turn);
    const handler = createInterviewAnswerPostHandler({ appUrl, answer });
    const response = await handler(
      jsonRequest(`/api/v1/interview-sessions/${sessionId}/messages`, {
        answer: turn.answer.content,
        questionKey: "ACADEMIC_INTERESTS",
      }),
      sessionId,
    );
    const missingResponse = await handler(
      jsonRequest("/api/v1/interview-sessions/not-a-uuid/messages", {
        answer: turn.answer.content,
        questionKey: "ACADEMIC_INTERESTS",
      }),
      "not-a-uuid",
    );

    expect(response.status).toBe(201);
    expect(
      apiSuccessSchema(interviewTurnSchema).parse(await response.json()).data,
    ).toEqual(turn);
    expect(missingResponse.status).toBe(404);
    expect(apiErrorSchema.parse(await missingResponse.json()).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("returns only a fixed safety recovery code, never provider detail", async () => {
    const response = await createInterviewAnswerPostHandler({
      appUrl,
      answer: vi
        .fn()
        .mockRejectedValue(new InterviewError("VALIDATION_ERROR", "SELF_HARM")),
    })(
      jsonRequest(`/api/v1/interview-sessions/${sessionId}/messages`, {
        answer: "Synthetic safety fixture",
        questionKey: "ACADEMIC_INTERESTS",
      }),
      sessionId,
    );

    const body = apiErrorSchema.parse(await response.json());
    expect(response.status).toBe(422);
    expect(body.error.fieldErrors).toEqual([
      { code: "SELF_HARM", path: "answer" },
    ]);
    expect(JSON.stringify(body)).not.toContain("provider");
  });

  it("rejects cross-origin mutations without calling application services", async () => {
    const start = vi.fn();
    const response = await createInterviewStartPostHandler({ appUrl, start })(
      jsonRequest("/api/v1/interview-sessions", {}, "https://evil.test"),
    );

    expect(response.status).toBe(422);
    expect(start).not.toHaveBeenCalled();
  });
});
