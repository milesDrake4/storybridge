import { describe, expect, it, vi } from "vitest";

import {
  createStoryFactPatchHandler,
  createStoryFactSuppressionPutHandler,
  createStoryFactVerificationPostHandler,
  createStoryProfileGetHandler,
} from "@/app/api/v1/story-vault/handler";
import type {
  InterviewMessageId,
  InterviewSessionId,
  StoryFactId,
  StoryProfileId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  StoryFact,
  StoryProfile,
  StoryProfileWithFacts,
} from "@/contracts/domain/story-vault";
import { apiErrorSchema } from "@/contracts/http/v1/envelopes";
import type { StoryVaultRepository } from "@/repositories/story-vault-repository";
import {
  getStoryVault,
  suppressStoryFact,
  updateStoryFact,
  verifyStoryFact,
} from "@/services/story-vault/manage-facts";

const now = new Date("2026-08-02T20:00:00Z");
const appUrl = new URL("https://storybridge.test");
const userId = "c0000000-0000-4000-8000-000000000001" as UserId;
const profileId = "c1000000-0000-4000-8000-000000000001" as StoryProfileId;
const factId = "c2000000-0000-4000-8000-000000000001" as StoryFactId;
const messageId = "c3000000-0000-4000-8000-000000000001" as InterviewMessageId;
const sessionId = "c4000000-0000-4000-8000-000000000001" as InterviewSessionId;
const contentHmac = "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
const fact: StoryFact = {
  category: "ACADEMICS",
  contentHmac,
  createdAt: now.toISOString(),
  details: ["Returns to synthetic biology"],
  id: factId,
  profileId,
  revision: 1,
  sourceMessageIds: [messageId],
  summary: "Sustained academic interest",
  suppressedAt: null,
  updatedAt: now.toISOString(),
  userId,
  verificationStatus: "UNVERIFIED",
  verifiedAt: null,
};
const current: StoryProfileWithFacts = {
  facts: [
    {
      ...fact,
      sources: [
        {
          content: "Synthetic biology keeps pulling me back.",
          id: messageId,
          questionKey: "ACADEMIC_INTERESTS",
        },
      ],
    },
  ],
  profile,
};

function repository(
  overrides: Partial<StoryVaultRepository> = {},
): StoryVaultRepository {
  return {
    create: vi.fn(),
    deleteFact: vi.fn().mockResolvedValue(true),
    findById: vi.fn(),
    findBySession: vi.fn(),
    getCurrent: vi.fn().mockResolvedValue(current),
    getFactsForAi: vi.fn().mockResolvedValue([fact]),
    getInterview: vi.fn(),
    suppressFact: vi.fn().mockResolvedValue({
      type: "UPDATED",
      value: { ...fact, revision: 2, suppressedAt: now.toISOString() },
    }),
    updateFact: vi.fn().mockResolvedValue({
      type: "UPDATED",
      value: {
        ...fact,
        contentHmac: "v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        details: ["Edited detail"],
        revision: 2,
        summary: "Edited summary",
      },
    }),
    updateProfile: vi.fn(),
    verifyFact: vi.fn().mockResolvedValue({
      type: "UPDATED",
      value: {
        ...fact,
        revision: 2,
        verificationStatus: "VERIFIED",
        verifiedAt: now.toISOString(),
      },
    }),
    ...overrides,
  };
}

function dependencies(vault = repository()) {
  return {
    hmacSecrets: {
      content: "test-content-hmac-secret-00000000002",
      idempotency: "test-idempotency-hmac-secret-000003",
      ip: "test-ip-hmac-secret-000000000000001",
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
    vault,
  };
}

function request(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(new URL(path, appUrl), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: appUrl.host,
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    method,
  });
}

describe("Story Vault fact lifecycle", () => {
  it("returns source-visible current facts", async () => {
    await expect(getStoryVault(dependencies(), now)).resolves.toEqual(current);
  });

  it("re-HMACs edited content and delegates an atomic un-verifying update", async () => {
    const deps = dependencies();
    const updated = await updateStoryFact(
      factId,
      1,
      { details: ["Edited detail"], summary: "Edited summary" },
      deps,
      now,
    );

    expect(updated.verificationStatus).toBe("UNVERIFIED");
    expect(deps.vault.updateFact).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
        expectedRevision: 1,
        factId,
      }),
    );
  });

  it("maps stale verification to the stable precondition failure", async () => {
    const deps = dependencies(
      repository({
        verifyFact: vi.fn().mockResolvedValue({ type: "REVISION_MISMATCH" }),
      }),
    );

    await expect(
      verifyStoryFact(
        factId,
        { contentHash: contentHmac, decision: "VERIFY", expectedRevision: 1 },
        deps,
        now,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "REVISION_MISMATCH" }));
  });

  it("suppresses through the repository and exposes only its filtered AI query", async () => {
    const deps = dependencies();
    await expect(
      suppressStoryFact(factId, true, deps, now),
    ).resolves.toMatchObject({
      suppressedAt: now.toISOString(),
    });
    expect(deps.vault.suppressFact).toHaveBeenCalledWith({
      factId,
      now,
      suppressed: true,
      userId,
    });
    await expect(deps.vault.getFactsForAi(userId)).resolves.toEqual([fact]);
  });
});

describe("Story Vault HTTP contracts", () => {
  it("returns the profile ETag with source-visible facts", async () => {
    const response = await createStoryProfileGetHandler({
      get: vi.fn().mockResolvedValue(current),
    })();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"profile:${profileId}:r1"`);
  });

  it("requires an exact fact ETag and returns the next revision", async () => {
    const update = vi.fn().mockResolvedValue({ ...fact, revision: 2 });
    const handler = createStoryFactPatchHandler({ appUrl, update });
    const missing = await handler(
      request(`/api/v1/story-facts/${factId}`, "PATCH", {
        details: ["Edited detail"],
        summary: "Edited summary",
      }),
      factId,
    );
    const response = await handler(
      request(
        `/api/v1/story-facts/${factId}`,
        "PATCH",
        { details: ["Edited detail"], summary: "Edited summary" },
        { "if-match": `"fact:${factId}:r1"` },
      ),
      factId,
    );

    expect(missing.status).toBe(428);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"fact:${factId}:r2"`);
  });

  it("rejects mismatched verification body/header revisions before mutation", async () => {
    const verify = vi.fn();
    const response = await createStoryFactVerificationPostHandler({
      appUrl,
      verify,
    })(
      request(
        `/api/v1/story-facts/${factId}/verification`,
        "POST",
        { contentHash: contentHmac, decision: "VERIFY", expectedRevision: 2 },
        {
          "idempotency-key": "synthetic-verification-key-0001",
          "if-match": `"fact:${factId}:r1"`,
        },
      ),
      factId,
    );

    expect(response.status).toBe(412);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "REVISION_MISMATCH",
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it("requires idempotency for suppression", async () => {
    const suppress = vi.fn();
    const response = await createStoryFactSuppressionPutHandler({
      appUrl,
      suppress,
    })(
      request(`/api/v1/story-facts/${factId}/suppression`, "PUT", {
        suppressed: true,
      }),
      factId,
    );
    expect(response.status).toBe(428);
    expect(suppress).not.toHaveBeenCalled();
  });
});
