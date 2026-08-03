import { describe, expect, it, vi } from "vitest";

import {
  createEssayDeleteHandler,
  createEssayGetHandler,
  createEssayPostHandler,
  createEssaysGetHandler,
} from "@/app/api/v1/essays/handler";
import type { EssayId, SchoolId, UserId } from "@/contracts/domain/ids";

import {
  createEssayInputSchema,
  essayListQuerySchema,
} from "@/contracts/http/v1/essays";
import { hasPromptPrivacyRisk } from "@/services/essays/prompt-privacy";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import {
  createEssayWorkspace,
  deleteEssayWorkspace,
  getEssayWorkspace,
  listEssayWorkspaces,
} from "@/services/essays/manage-workspaces";

const schoolId = "f1000000-0000-4000-8000-000000000001" as SchoolId;
const essayId = "f2000000-0000-4000-8000-000000000001" as EssayId;
const secondEssayId = "f2000000-0000-4000-8000-000000000002" as EssayId;
const userId = "f0000000-0000-4000-8000-000000000001" as UserId;
const appUrl = new URL("https://storybridge.test");
const now = new Date("2026-08-03T16:00:00.000Z");

const workspace = {
  essay: {
    createdAt: "2026-08-03T15:00:00.000Z",
    dossierId: null,
    id: essayId,
    prompt: "Describe a community that has shaped your perspective.",
    revision: 0,
    schoolId,
    selectedAngleId: null,
    season: "2026-2027" as const,
    status: "STRATEGY" as const,
    updatedAt: "2026-08-03T15:00:00.000Z",
    userId,
    wordLimit: 300,
  },
  school: {
    canonicalName: "University of Michigan",
    id: schoolId,
    officialDomain: "umich.edu",
  },
};

function eligibility() {
  return {
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

function repository(
  overrides: Partial<EssayWorkspaceRepository> = {},
): EssayWorkspaceRepository {
  return {
    create: vi.fn().mockResolvedValue({ type: "CREATED", value: workspace }),
    delete: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(workspace),
    list: vi.fn().mockResolvedValue([workspace]),
    ...overrides,
  };
}

function dependencies(essays = repository()) {
  return {
    ...eligibility(),
    cursorSecret: "cursor-secret-at-least-32-characters",
    essays,
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
    },
  };
}

function mutationRequest(
  path: string,
  method: "DELETE" | "POST",
  body?: unknown,
  idempotencyKey?: string,
) {
  return new Request(new URL(path, appUrl), {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: appUrl.host,
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    method,
  });
}

describe("essay workspace contracts", () => {
  it("accepts only a registry school, prompt, and word limit on creation", () => {
    expect(
      createEssayInputSchema.parse({
        prompt: "What community has shaped how you see the world today?",
        schoolId,
        wordLimit: 500,
      }),
    ).toEqual({
      prompt: "What community has shaped how you see the world today?",
      schoolId,
      wordLimit: 500,
    });

    for (const extra of [
      { officialDomain: "attacker.example" },
      { status: "COMPLETE" },
      { userId: "f0000000-0000-4000-8000-000000000099" },
    ]) {
      expect(() =>
        createEssayInputSchema.parse({
          prompt: "What community has shaped how you see the world today?",
          schoolId,
          wordLimit: 500,
          ...extra,
        }),
      ).toThrow();
    }
  });

  it("enforces prompt and word-limit boundaries", () => {
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "too short",
        schoolId,
        wordLimit: 500,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "x".repeat(2_001),
        schoolId,
        wordLimit: 500,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "Describe a meaningful contribution to your community.",
        schoolId,
        wordLimit: 24,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "Describe a meaningful contribution to your community.",
        schoolId,
        wordLimit: 1_001,
      }),
    ).toThrow();
  });

  it("accepts only bounded list pagination fields", () => {
    expect(essayListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(() => essayListQuerySchema.parse({ limit: 51 })).toThrow();
    expect(() => essayListQuerySchema.parse({ ownerId: schoolId })).toThrow();
  });
});

describe("essay prompt privacy classifier", () => {
  it("allows server-facing school prompt text", () => {
    expect(
      hasPromptPrivacyRisk(
        "Describe a community that has shaped your perspective and how you would contribute to campus.",
      ),
    ).toBe(false);
  });

  it.each([
    "Here is my essay draft: I grew up translating for my parents.",
    "My personal statement explains how my family moved three times.",
    "I learned resilience when I led my robotics team through a difficult season.",
    "Notes about me: my GPA is 3.8 and I volunteer at the hospital.",
  ])("flags likely personal notes or essay prose: %s", (prompt) => {
    expect(hasPromptPrivacyRisk(prompt)).toBe(true);
  });
});

describe("essay workspace service", () => {
  it("creates a normalized workspace with keyed request and idempotency hashes", async () => {
    const essays = repository();
    await createEssayWorkspace(
      {
        prompt: "Describe a community that has shaped your perspective.\r\n",
        schoolId,
        wordLimit: 300,
      },
      { idempotencyKey: "essay-create-key-00000001" },
      dependencies(essays),
      now,
    );

    expect(essays.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKeyHmac: expect.stringMatching(/^v1\./),
        prompt: "Describe a community that has shaped your perspective.",
        requestHmac: expect.stringMatching(/^v1\./),
        season: "2026-2027",
        userId,
      }),
    );
  });

  it("rejects likely personal prose before persistence", async () => {
    const essays = repository();
    await expect(
      createEssayWorkspace(
        {
          prompt:
            "Here is my essay draft: I grew up translating for my parents.",
          schoolId,
          wordLimit: 300,
        },
        { idempotencyKey: "essay-create-key-00000002" },
        dependencies(essays),
        now,
      ),
    ).rejects.toMatchObject({ code: "PROMPT_PRIVACY_RISK" });
    expect(essays.create).not.toHaveBeenCalled();
  });

  it("maps allowance and registry decisions to stable API errors", async () => {
    for (const [type, code] of [
      ["QUOTA_EXCEEDED", "QUOTA_EXCEEDED"],
      ["UNSUPPORTED_SCHOOL", "UNSUPPORTED_SCHOOL"],
      ["IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
    ] as const) {
      await expect(
        createEssayWorkspace(
          {
            prompt: "Describe a community that has shaped your perspective.",
            schoolId,
            wordLimit: 300,
          },
          { idempotencyKey: "essay-create-key-00000003" },
          dependencies(
            repository({ create: vi.fn().mockResolvedValue({ type }) }),
          ),
          now,
        ),
      ).rejects.toMatchObject({ code });
    }
  });

  it("signs stable pagination state and binds it to the owner", async () => {
    const second = {
      ...workspace,
      essay: {
        ...workspace.essay,
        id: secondEssayId,
        updatedAt: "2026-08-03T14:00:00.000Z",
      },
    };
    const essays = repository({
      list: vi.fn().mockResolvedValue([workspace, second]),
    });
    const deps = dependencies(essays);
    const first = await listEssayWorkspaces(
      { cursor: undefined, limit: 1 },
      deps,
      now,
    );

    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{64,}$/);
    await listEssayWorkspaces(
      { cursor: first.nextCursor ?? undefined, limit: 1 },
      deps,
      now,
    );
    expect(essays.list).toHaveBeenLastCalledWith({
      after: { id: essayId, updatedAt: workspace.essay.updatedAt },
      limit: 2,
      userId,
    });

    const otherUserId = "f0000000-0000-4000-8000-000000000002" as UserId;
    await expect(
      listEssayWorkspaces(
        { cursor: first.nextCursor ?? undefined, limit: 1 },
        {
          ...deps,
          session: {
            requireUserId: vi.fn().mockResolvedValue(otherUserId),
          },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("keeps get and delete owner-scoped at the repository boundary", async () => {
    const essays = repository();
    const deps = dependencies(essays);
    await expect(getEssayWorkspace(essayId, deps, now)).resolves.toEqual(
      workspace,
    );
    await deleteEssayWorkspace(essayId, deps, now);
    expect(essays.get).toHaveBeenCalledWith(userId, essayId);
    expect(essays.delete).toHaveBeenCalledWith(userId, essayId);
  });
});

describe("essay workspace HTTP contract", () => {
  it("rejects arbitrary list fields before service work", async () => {
    const list = vi.fn();
    const response = await createEssaysGetHandler({ list })(
      new Request(`${appUrl}api/v1/essays?ownerId=${userId}`),
    );
    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("creates with 201 and an essay revision ETag", async () => {
    const create = vi.fn().mockResolvedValue(workspace);
    const response = await createEssayPostHandler({ appUrl, create })(
      mutationRequest(
        "/api/v1/essays",
        "POST",
        {
          prompt: workspace.essay.prompt,
          schoolId,
          wordLimit: 300,
        },
        "essay-create-key-00000004",
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe(`"essay:${essayId}:r0"`);
  });

  it("returns an owner workspace ETag and masks invalid identifiers", async () => {
    const get = vi.fn().mockResolvedValue(workspace);
    const handler = createEssayGetHandler({ get });
    const found = await handler(essayId);
    const invalid = await handler("not-an-id");
    expect(found.headers.get("etag")).toBe(`"essay:${essayId}:r0"`);
    expect(invalid.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("requires idempotency for deletion and safely replays as 204", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createEssayDeleteHandler({ appUrl, delete: remove });
    const missingKey = await handler(
      mutationRequest(`/api/v1/essays/${essayId}`, "DELETE"),
      essayId,
    );
    const deleted = await handler(
      mutationRequest(
        `/api/v1/essays/${essayId}`,
        "DELETE",
        undefined,
        "essay-delete-key-00000001",
      ),
      essayId,
    );
    expect(missingKey.status).toBe(428);
    expect(deleted.status).toBe(204);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
