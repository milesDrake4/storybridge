import { describe, expect, it, vi } from "vitest";

import { createInterviewCompletePostHandler } from "@/app/api/v1/interview-sessions/[sessionId]/complete/handler";
import type {
  AiOperationId,
  InterviewSessionId,
  StoryProfileId,
  UserId,
} from "@/contracts/domain/ids";
import {
  storyExtractionSchema,
  storyProfileSchema,
  type StoryProfile,
} from "@/contracts/domain/story-vault";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import type { InterviewSessionWithMessages } from "@/contracts/http/v1/interviews";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import {
  extractStoryProfile,
  StoryExtractionError,
} from "@/services/story-vault/extract-profile";

const now = new Date("2026-08-02T18:00:00Z");
const userId = "b0000000-0000-4000-8000-000000000001" as UserId;
const sessionId = "b1000000-0000-4000-8000-000000000001" as InterviewSessionId;
const profileId = "b2000000-0000-4000-8000-000000000001" as StoryProfileId;
const operationId = "b3000000-0000-4000-8000-000000000001" as AiOperationId;
const messageId = "b4000000-0000-4000-8000-000000000001";

const profile: StoryProfile = {
  createdAt: now.toISOString(),
  excludedTopics: [],
  id: profileId,
  revision: 1,
  sourceSessionId: sessionId,
  status: "REVIEW_REQUIRED",
  updatedAt: now.toISOString(),
  userId,
  version: 1,
  voiceProfile: {
    sentenceStyle: "Direct, then reflective",
    toneTraits: ["reflective"],
    vocabulary: "Concrete and restrained",
  },
};
const transcript = {
  completedAt: now.toISOString(),
  coverage: {
    academicInterests: true,
    activities: true,
    experiences: 3,
    goals: true,
    responsibilities: true,
    values: true,
    voice: true,
  },
  createdAt: now.toISOString(),
  currentQuestionKey: null,
  id: sessionId,
  messages: [
    {
      content: "What keeps pulling you back?",
      createdAt: now.toISOString(),
      id: "b4000000-0000-4000-8000-000000000000",
      questionKey: "ACADEMIC_INTERESTS",
      role: "ASSISTANT",
      sequence: 0,
      sessionId,
      userId,
    },
    {
      content: "Synthetic biology keeps pulling me back.",
      createdAt: now.toISOString(),
      id: messageId,
      questionKey: "ACADEMIC_INTERESTS",
      role: "USER",
      sequence: 1,
      sessionId,
      userId,
    },
  ],
  status: "COMPLETE",
  updatedAt: now.toISOString(),
  userId,
} as InterviewSessionWithMessages;

function vaultRepository(
  overrides: Partial<StoryVaultRepository> = {},
): StoryVaultRepository {
  return {
    create: vi.fn().mockResolvedValue({ profile, type: "CREATED" }),
    findById: vi.fn().mockResolvedValue(profile),
    findBySession: vi.fn().mockResolvedValue(null),
    getInterview: vi.fn().mockResolvedValue(transcript),
    ...overrides,
  };
}

function dependencies(vault = vaultRepository()) {
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
    limits: {
      betaAccountCap: 25,
      dailyAiCallLimit: 50,
      monthlyOpenAiBudgetCents: 15_000,
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
    structured: {
      generate: vi.fn().mockResolvedValue({
        model: "gpt-test",
        requestId: "resp_synthetic_extraction",
        usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
        value: {
          facts: [
            {
              category: "ACADEMICS" as const,
              certainty: "EXPLICIT" as const,
              details: ["Returns repeatedly to synthetic biology"],
              sensitive: false as const,
              sourceMessageIds: [messageId],
              summary: "Sustained interest in synthetic biology",
            },
          ],
          voiceProfile: profile.voiceProfile,
        },
      }),
    },
    vault,
  };
}

const request = {
  idempotencyKey: "synthetic-extraction-key-0001",
  ipAddress: "203.0.113.8",
};
const appUrl = new URL("https://storybridge.test");

function completionRequest(origin = appUrl.origin) {
  return new Request(
    new URL(`/api/v1/interview-sessions/${sessionId}/complete`, appUrl),
    {
      body: "{}",
      headers: {
        "content-type": "application/json",
        host: appUrl.host,
        "idempotency-key": request.idempotencyKey,
        origin,
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    },
  );
}

describe("Story Vault extraction", () => {
  it("creates source-linked, content-HMACed facts from explicit transcript evidence", async () => {
    const deps = dependencies();

    await expect(
      extractStoryProfile(sessionId, request, deps, now),
    ).resolves.toEqual(profile);

    expect(deps.structured.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringMatching(/Do not infer or assert health/),
        purpose: "STORY_EXTRACTION",
        userId,
      }),
    );
    const persisted = vi.mocked(deps.vault.create).mock.calls[0][0];
    expect(persisted.facts[0]).toMatchObject({
      category: "ACADEMICS",
      sourceMessageIds: [messageId],
      summary: "Sustained interest in synthetic biology",
    });
    expect(persisted.facts[0].contentHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(deps.aiOperations.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { id: profileId, type: "STORY_PROFILE" },
        status: "SUCCEEDED",
      }),
    );
  });

  it("makes inferred or sensitive candidates invalid structured output", () => {
    const base = {
      category: "VALUES",
      details: ["Synthetic detail"],
      sourceMessageIds: [messageId],
      summary: "Synthetic summary",
    };
    expect(
      storyExtractionSchema.safeParse({
        facts: [{ ...base, certainty: "INFERRED", sensitive: false }],
        voiceProfile: profile.voiceProfile,
      }).success,
    ).toBe(false);
    expect(
      storyExtractionSchema.safeParse({
        facts: [{ ...base, certainty: "EXPLICIT", sensitive: true }],
        voiceProfile: profile.voiceProfile,
      }).success,
    ).toBe(false);
  });

  it("returns an existing profile before reserving or calling the provider", async () => {
    const deps = dependencies(
      vaultRepository({ findBySession: vi.fn().mockResolvedValue(profile) }),
    );

    await expect(
      extractStoryProfile(sessionId, request, deps, now),
    ).resolves.toEqual(profile);
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
    expect(deps.structured.generate).not.toHaveBeenCalled();
  });

  it("returns targeted insufficient-evidence failure before a provider call", async () => {
    const deps = dependencies(
      vaultRepository({
        getInterview: vi.fn().mockResolvedValue({
          ...transcript,
          status: "ACTIVE",
          completedAt: null,
          currentQuestionKey: "VALUES",
        }),
      }),
    );

    await expect(
      extractStoryProfile(sessionId, request, deps, now),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_EVIDENCE",
      targetQuestionKey: "VALUES",
    });
    expect(deps.aiOperations.reserve).not.toHaveBeenCalled();
    expect(deps.structured.generate).not.toHaveBeenCalled();
  });

  it("rejects provider facts that cite unknown or assistant message IDs", async () => {
    const deps = dependencies();
    deps.structured.generate.mockResolvedValue({
      model: "gpt-test",
      requestId: "resp_synthetic_invalid_source",
      usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
      value: {
        facts: [
          {
            category: "VALUES",
            certainty: "EXPLICIT",
            details: ["Unsupported synthetic detail"],
            sensitive: false,
            sourceMessageIds: [transcript.messages[0].id],
            summary: "Unsupported inference",
          },
        ],
        voiceProfile: profile.voiceProfile,
      },
    });

    const failure = await extractStoryProfile(
      sessionId,
      request,
      deps,
      now,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StoryExtractionError);
    expect(failure).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(deps.vault.create).not.toHaveBeenCalled();
  });

  it("replays a completed AI operation without generating or persisting again", async () => {
    const deps = dependencies();
    deps.aiOperations.reserve.mockResolvedValue({
      operationId,
      originalHttpStatus: 201,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      resource: { id: profileId, type: "STORY_PROFILE" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });

    await expect(
      extractStoryProfile(sessionId, request, deps, now),
    ).resolves.toEqual(profile);
    expect(deps.structured.generate).not.toHaveBeenCalled();
    expect(deps.vault.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/interview-sessions/{sessionId}/complete", () => {
  it("returns the created profile in the canonical envelope", async () => {
    const complete = vi.fn().mockResolvedValue(profile);
    const response = await createInterviewCompletePostHandler({
      appUrl,
      complete,
    })(completionRequest(), sessionId);

    expect(response.status).toBe(201);
    expect(
      apiSuccessSchema(storyProfileSchema).parse(await response.json()).data,
    ).toEqual(profile);
    expect(complete).toHaveBeenCalledWith(sessionId, {
      idempotencyKey: request.idempotencyKey,
      ipAddress: "0.0.0.0",
    });
  });

  it("returns a fixed targeted recovery code for incomplete coverage", async () => {
    const response = await createInterviewCompletePostHandler({
      appUrl,
      complete: vi
        .fn()
        .mockRejectedValue(
          new StoryExtractionError("INSUFFICIENT_EVIDENCE", "VALUES"),
        ),
    })(completionRequest(), sessionId);

    const body = apiErrorSchema.parse(await response.json());
    expect(response.status).toBe(422);
    expect(body.error.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(body.error.fieldErrors).toEqual([
      { code: "MISSING_VALUES", path: "interview" },
    ]);
  });

  it("rejects cross-origin completion before any application work", async () => {
    const complete = vi.fn();
    const response = await createInterviewCompletePostHandler({
      appUrl,
      complete,
    })(completionRequest("https://evil.test"), sessionId);

    expect(response.status).toBe(422);
    expect(complete).not.toHaveBeenCalled();
  });
});
