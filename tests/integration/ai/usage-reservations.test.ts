import { describe, expect, it, vi } from "vitest";

import type { AiOperationId, UserId } from "@/contracts/domain/ids";
import { errorStatusByCode } from "@/contracts/http/v1/errors";
import type { AiOperationRepository } from "@/repositories/ai-operation-repository";
import {
  AiOperationError,
  reserveAiOperation,
  startAiOperation,
} from "@/services/ai/reserve-operation";

const userId = "70000000-0000-4000-8000-000000000001" as UserId;
const operationId = "71000000-0000-4000-8000-000000000001" as AiOperationId;
const now = new Date("2026-08-02T12:00:00Z");
const hmacSecrets = {
  content: "test-content-hmac-secret-00000000002",
  idempotency: "test-idempotency-hmac-secret-000003",
  ip: "test-ip-hmac-secret-000000000000001",
};

function repositoryWith(
  result: Awaited<ReturnType<AiOperationRepository["reserve"]>>,
) {
  return {
    release: vi.fn(),
    reserve: vi.fn().mockResolvedValue(result),
    start: vi.fn(),
    finalize: vi.fn(),
  } satisfies AiOperationRepository;
}

const input = {
  canonicalRequest: '{"answer":"Synthetic private input"}',
  estimatedCostCents: 12,
  idempotencyKey: "client-generated-key",
  ipAddress: "203.0.113.8",
  method: "POST" as const,
  purpose: "INTERVIEW_REPLY" as const,
  route: "/api/v1/interview-sessions/current/messages",
  userId,
};

const limits = {
  betaAccountCap: 25,
  dailyAiCallLimit: 50,
  monthlyOpenAiBudgetCents: 15_000,
};

describe("AI usage reservations", () => {
  it("HMACs sensitive reservation inputs before calling the repository", async () => {
    const repository = repositoryWith({
      operationId,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      type: "RESERVED",
    });

    await expect(
      reserveAiOperation(input, {
        hmacSecrets,
        limits,
        now: () => now,
        repository,
      }),
    ).resolves.toEqual({
      operationId,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      type: "RESERVED",
    });

    expect(repository.reserve).toHaveBeenCalledOnce();
    const persisted = repository.reserve.mock.calls[0][0];
    expect(persisted.idempotencyKeyHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(persisted.requestHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(persisted.ipHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(persisted)).not.toContain(input.idempotencyKey);
    expect(JSON.stringify(persisted)).not.toContain(input.ipAddress);
    expect(JSON.stringify(persisted)).not.toContain("Synthetic private input");
  });

  it("returns the original immutable resource for same-body replay", async () => {
    const resourceId = "72000000-0000-4000-8000-000000000001";
    const repository = repositoryWith({
      operationId,
      originalHttpStatus: 201,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      resource: { id: resourceId, type: "INTERVIEW_TURN" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });

    await expect(
      reserveAiOperation(input, {
        hmacSecrets,
        limits,
        now: () => now,
        repository,
      }),
    ).resolves.toMatchObject({
      operationId,
      originalHttpStatus: 201,
      resource: { id: resourceId, type: "INTERVIEW_TURN" },
      status: "SUCCEEDED",
      type: "REPLAY",
    });
  });

  it.each([
    ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_KEY_REUSED"],
    ["QUOTA_EXCEEDED", "QUOTA_EXCEEDED"],
    ["BETA_CAP_REACHED", "BETA_CAP_REACHED"],
    ["BUDGET_EXHAUSTED", "AI_BUDGET_EXHAUSTED"],
    ["FALLBACK_LIMIT_REACHED", "QUOTA_EXCEEDED"],
  ] as const)("maps %s to stable HTTP error %s", async (decision, code) => {
    const repository = repositoryWith({
      resetAt: new Date("2026-08-03T00:00:00Z"),
      type: decision,
    });

    const failure = await reserveAiOperation(input, {
      hmacSecrets,
      limits,
      now: () => now,
      repository,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiOperationError);
    expect(failure).toMatchObject({ code });
    expect(errorStatusByCode[code]).toBe(
      code === "IDEMPOTENCY_KEY_REUSED"
        ? 409
        : code === "AI_BUDGET_EXHAUSTED"
          ? 503
          : 429,
    );
  });

  it("never treats an already-started replay as provider-call permission", async () => {
    const repository = repositoryWith({
      operationId,
      resetAt: new Date("2026-08-03T00:00:00Z"),
      type: "RESERVED",
    });
    repository.start.mockResolvedValue("ALREADY_STARTED");

    await expect(
      startAiOperation(operationId, repository, now),
    ).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
  });
});
