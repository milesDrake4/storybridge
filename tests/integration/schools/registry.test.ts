import { describe, expect, it, vi } from "vitest";

import {
  createSchoolRequestPostHandler,
  createSchoolsGetHandler,
} from "@/app/api/v1/schools/handler";
import type { UserId } from "@/contracts/domain/ids";
import type { SchoolRegistryRepository } from "@/repositories/school-registry-repository";
import {
  createSchoolRequest,
  searchSchools,
} from "@/services/schools/school-registry-service";

const appUrl = new URL("https://storybridge.test");
const now = new Date("2026-08-02T23:00:00.000Z");
const userId = "f0000000-0000-4000-8000-000000000001" as UserId;
const school = {
  canonicalName: "Example University",
  id: "f1000000-0000-4000-8000-000000000001",
  officialDomain: "example.edu",
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
  overrides: Partial<SchoolRegistryRepository> = {},
): SchoolRegistryRepository {
  return {
    createRequest: vi.fn().mockResolvedValue({
      type: "CREATED",
      value: {
        createdAt: now.toISOString(),
        id: "f2000000-0000-4000-8000-000000000001",
        name: "Unsupported College",
        status: "PENDING",
        updatedAt: now.toISOString(),
        url: "https://unsupported.example.edu",
        userId,
      },
    }),
    search: vi.fn().mockResolvedValue([school]),
    ...overrides,
  };
}

function mutationRequest(body: unknown, idempotencyKey?: string) {
  return new Request(new URL("/api/v1/school-requests", appUrl), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: appUrl.host,
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    method: "POST",
  });
}

describe("verified school registry service", () => {
  it("returns only repository-backed active school summaries", async () => {
    const schools = repository();
    const result = await searchSchools(
      { cursor: undefined, limit: 20, query: "example" },
      {
        ...eligibility(),
        cursorSecret: "cursor-secret-at-least-32-characters",
        schools,
      },
      now,
    );

    expect(result).toEqual({ items: [school], nextCursor: null });
    expect(schools.search).toHaveBeenCalledWith({
      after: null,
      limit: 21,
      query: "example",
    });
  });

  it("signs pagination state and rejects a cursor reused for another search", async () => {
    const secondSchool = {
      canonicalName: "Second University",
      id: "f1000000-0000-4000-8000-000000000002",
      officialDomain: "second.edu",
    };
    const schools = repository({
      search: vi.fn().mockResolvedValue([school, secondSchool]),
    });
    const dependencies = {
      ...eligibility(),
      cursorSecret: "cursor-secret-at-least-32-characters",
      schools,
    };
    const first = await searchSchools(
      { cursor: undefined, limit: 1, query: "example" },
      dependencies,
      now,
    );

    expect(first.items).toEqual([school]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{64,}$/);
    await expect(
      searchSchools(
        { cursor: first.nextCursor ?? undefined, limit: 1, query: "second" },
        dependencies,
        now,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "INVALID_QUERY" }));
  });

  it("creates an owner-scoped request with keyed request and idempotency hashes", async () => {
    const schools = repository();
    await createSchoolRequest(
      { name: "Unsupported College", url: "https://unsupported.example.edu" },
      { idempotencyKey: "request-key-00000001" },
      {
        ...eligibility(),
        hmacSecrets: {
          content: "content-secret-at-least-32-characters",
          idempotency: "idempotency-secret-at-least-32-characters",
          ip: "ip-secret-at-least-32-characters",
        },
        schools,
      },
      now,
    );

    expect(schools.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKeyHmac: expect.stringMatching(/^v1\./),
        requestHmac: expect.stringMatching(/^v1\./),
        userId,
      }),
    );
  });
});

describe("verified school registry HTTP contract", () => {
  it("rejects invalid cursors and arbitrary query fields", async () => {
    const search = vi.fn();
    const handler = createSchoolsGetHandler({ search });
    const invalidCursor = await handler(
      new Request(`${appUrl}api/v1/schools?cursor=not-a-signed-cursor`),
    );
    const arbitraryDomain = await handler(
      new Request(`${appUrl}api/v1/schools?domain=attacker.example`),
    );

    expect(invalidCursor.status).toBe(400);
    expect(arbitraryDomain.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects caller-controlled domains in unsupported-school requests", async () => {
    const create = vi.fn();
    const response = await createSchoolRequestPostHandler({ appUrl, create })(
      mutationRequest(
        { domain: "attacker.example", name: "Unsupported College" },
        "request-key-00000001",
      ),
    );

    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires idempotency and accepts only HTTPS request URLs", async () => {
    const create = vi.fn();
    const handler = createSchoolRequestPostHandler({ appUrl, create });
    const missingKey = await handler(
      mutationRequest({ name: "Unsupported College" }),
    );
    const insecureUrl = await handler(
      mutationRequest(
        { name: "Unsupported College", url: "http://unsupported.example" },
        "request-key-00000001",
      ),
    );

    expect(missingKey.status).toBe(428);
    expect(insecureUrl.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });
});
