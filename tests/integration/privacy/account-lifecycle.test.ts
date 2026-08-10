import { describe, expect, it, vi } from "vitest";

import { createAccountDeletionWorkerHandler } from "@/app/api/internal/account-deletions/handler";
import {
  createAccountDeletionStatusHandler,
  createAccountExportHandler,
  createDeleteAccountHandler,
} from "@/app/api/v1/me/handler";

import type { AccountDeletionId, UserId } from "@/contracts/domain/ids";
import {
  deleteAccountInputSchema,
  deletionRequestSchema,
  deletionStatusTokenSchema,
} from "@/contracts/http/v1/me";
import type { AccountDeletionRepository } from "@/repositories/account-deletion-repository";
import type { AccountDeletionWorkerRepository } from "@/repositories/account-deletion-repository";
import type { AccountExportRepository } from "@/repositories/account-export-repository";
import { createAccountDeletionTokens } from "@/services/privacy/account-deletion-tokens";
import {
  AccountLifecycleError,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from "@/services/privacy/delete-account";
import { processNextAccountDeletion } from "@/services/privacy/process-account-deletion";
import {
  AccountExportError,
  exportAccountData,
  MAX_ACCOUNT_EXPORT_BYTES,
} from "@/services/privacy/export-account";

const now = new Date("2026-08-10T18:00:00.000Z");
const userId = "ff000000-0000-4000-8000-000000000001" as UserId;
const deletionId = "ff100000-0000-4000-8000-000000000001" as AccountDeletionId;
const statusToken = `dst_v1_${"a".repeat(43)}`;

function repository(): AccountDeletionRepository {
  return {
    getStatus: vi.fn().mockResolvedValue({
      completedAt: null,
      deletionId,
      requestedAt: now.toISOString(),
      status: "QUEUED",
    }),
    queue: vi.fn().mockResolvedValue({
      deletionId,
      requestedAt: now,
      type: "QUEUED",
    }),
  };
}

function dependencies(deletions = repository()) {
  return {
    deletions,
    session: {
      requireUserId: vi.fn().mockResolvedValue(userId),
      revokeAll: vi.fn().mockResolvedValue(undefined),
    },
    tokens: {
      hashStatusToken: vi.fn().mockReturnValue("v1.status-token-hmac"),
      issue: vi.fn().mockReturnValue({
        idempotencyKeyHmac: "v1.idempotency-hmac",
        statusToken,
        statusTokenHmac: "v1.status-token-hmac",
        userIdHmac: "v1.user-id-hmac",
      }),
    },
  };
}

describe("account deletion contracts", () => {
  it("requires explicit deletion confirmation and a bounded opaque token", () => {
    expect(deleteAccountInputSchema.parse({ confirmation: "DELETE" })).toEqual({
      confirmation: "DELETE",
    });
    expect(() =>
      deleteAccountInputSchema.parse({ confirmation: "delete" }),
    ).toThrow();
    expect(deletionStatusTokenSchema.parse(statusToken)).toBe(statusToken);
    expect(() => deletionStatusTokenSchema.parse("raw-token")).toThrow();
  });

  it("derives replayable opaque tokens and purpose-separated stored HMACs", () => {
    const tokens = createAccountDeletionTokens({
      content: "content-secret-at-least-32-characters-long",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters-longer",
    });
    const first = tokens.issue(userId, "idempotency-key-1234");
    const replay = tokens.issue(userId, "idempotency-key-1234");

    expect(first).toEqual(replay);
    expect(first.statusToken).toMatch(/^dst_v1_[A-Za-z0-9_-]{43}$/);
    expect(first.statusTokenHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(first.userIdHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(first.idempotencyKeyHmac).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(new Set(Object.values(first)).size).toBe(4);
    expect(tokens.hashStatusToken(first.statusToken)).toBe(
      first.statusTokenHmac,
    );
  });
});

describe("account deletion lifecycle service", () => {
  it("queues for the authenticated user, stores only HMACs, then revokes all sessions", async () => {
    const deps = dependencies();

    await expect(
      requestAccountDeletion(deps, "idempotency-key-1234", now),
    ).resolves.toEqual({
      deletionId,
      status: "QUEUED",
      statusToken,
    });
    expect(deps.deletions.queue).toHaveBeenCalledWith({
      idempotencyKeyHmac: "v1.idempotency-hmac",
      requestedAt: now,
      statusTokenHmac: "v1.status-token-hmac",
      userId,
      userIdHmac: "v1.user-id-hmac",
    });
    expect(deps.session.revokeAll).toHaveBeenCalledOnce();
    expect(deps.session.revokeAll.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(deps.deletions.queue).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("returns the same one-time token for an idempotent replay", async () => {
    const deletions = repository();
    vi.mocked(deletions.queue).mockResolvedValueOnce({
      deletionId,
      requestedAt: now,
      type: "REPLAY",
    });

    await expect(
      requestAccountDeletion(
        dependencies(deletions),
        "idempotency-key-1234",
        now,
      ),
    ).resolves.toMatchObject({ deletionId, statusToken });
  });

  it("fails closed when another deletion key already owns the request", async () => {
    const deletions = repository();
    vi.mocked(deletions.queue).mockResolvedValueOnce({ type: "CONFLICT" });

    await expect(
      requestAccountDeletion(
        dependencies(deletions),
        "different-key-1234",
        now,
      ),
    ).rejects.toEqual(new AccountLifecycleError("STATE_CONFLICT"));
  });

  it("looks up status by token HMAC without requiring a user session", async () => {
    const deps = dependencies();

    await expect(
      getAccountDeletionStatus(statusToken, deps, now),
    ).resolves.toEqual({
      completedAt: null,
      deletionId,
      requestedAt: now.toISOString(),
      status: "QUEUED",
    });
    expect(deps.tokens.hashStatusToken).toHaveBeenCalledWith(statusToken);
    expect(deps.deletions.getStatus).toHaveBeenCalledWith({
      at: now,
      statusTokenHmac: "v1.status-token-hmac",
    });
  });

  it("does not disclose whether a missing or expired token ever existed", async () => {
    const deletions = repository();
    vi.mocked(deletions.getStatus).mockResolvedValueOnce(null);

    await expect(
      getAccountDeletionStatus(statusToken, dependencies(deletions), now),
    ).rejects.toEqual(new AccountLifecycleError("RESOURCE_NOT_FOUND"));
  });
});

describe("deletion response invariants", () => {
  it("rejects status payloads that contain profile content", () => {
    expect(() =>
      deletionRequestSchema.parse({
        deletionId,
        displayName: "Private name",
        status: "QUEUED",
        statusToken,
      }),
    ).toThrow();
  });
});

describe("account deletion worker", () => {
  function workerRepository(
    claimedUserId: UserId | null = userId,
  ): AccountDeletionWorkerRepository {
    return {
      claimNext: vi.fn().mockResolvedValue({
        attemptCount: 1,
        deletionId,
        userId: claimedUserId,
        userIdHmac: "v1.user-id-hmac",
      }),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
      prepare: vi.fn().mockResolvedValue(true),
    };
  }

  it("prepares blockers, deletes the provider identity, then completes", async () => {
    const deletions = workerRepository();
    const provider = { deleteUser: vi.fn().mockResolvedValue(undefined) };

    await expect(
      processNextAccountDeletion({ deletions, provider }, now),
    ).resolves.toBe("COMPLETE");
    expect(provider.deleteUser).toHaveBeenCalledWith(userId);
    expect(
      vi.mocked(deletions.prepare).mock.invocationCallOrder[0],
    ).toBeLessThan(provider.deleteUser.mock.invocationCallOrder[0] ?? 0);
    expect(provider.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deletions.complete).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("finishes a recovered job whose provider deletion already cleared user ID", async () => {
    const deletions = workerRepository(null);
    const provider = { deleteUser: vi.fn() };

    await expect(
      processNextAccountDeletion({ deletions, provider }, now),
    ).resolves.toBe("COMPLETE");
    expect(provider.deleteUser).not.toHaveBeenCalled();
  });

  it("leaves transient provider failures reclaimable without storing provider text", async () => {
    const deletions = workerRepository();
    const provider = {
      deleteUser: vi.fn().mockRejectedValue(new Error("private provider text")),
    };

    await expect(
      processNextAccountDeletion({ deletions, provider }, now),
    ).rejects.toThrow("ACCOUNT_DELETION_PROVIDER_RETRY");
    expect(deletions.fail).not.toHaveBeenCalled();
  });

  it("records only a bounded safe code after the final provider attempt", async () => {
    const deletions = workerRepository();
    vi.mocked(deletions.claimNext).mockResolvedValueOnce({
      attemptCount: 5,
      deletionId,
      userId,
      userIdHmac: "v1.user-id-hmac",
    });
    const provider = {
      deleteUser: vi.fn().mockRejectedValue(new Error("private provider text")),
    };

    await expect(
      processNextAccountDeletion({ deletions, provider }, now),
    ).resolves.toBe("FAILED");
    expect(deletions.fail).toHaveBeenCalledWith(
      deletionId,
      "PROVIDER_DELETE_FAILED",
      now,
    );
    expect(JSON.stringify(vi.mocked(deletions.fail).mock.calls)).not.toContain(
      "private provider text",
    );
  });
});

describe("account export", () => {
  const accountExport = {
    data: { essays: [{ draft_text: "My draft" }] },
    exportedAt: now.toISOString(),
    profile: { display_name: "Student" },
    schemaVersion: "2026-08-10" as const,
  };

  it("exports only for the authenticated identity without eligibility checks", async () => {
    const exports: AccountExportRepository = {
      get: vi.fn().mockResolvedValue({ export: accountExport, type: "READY" }),
    };
    const session = { requireUserId: vi.fn().mockResolvedValue(userId) };

    await expect(exportAccountData({ exports, session }, now)).resolves.toEqual(
      accountExport,
    );
    expect(exports.get).toHaveBeenCalledWith({
      at: now,
      maxBytes: MAX_ACCOUNT_EXPORT_BYTES,
      userId,
    });
  });

  it("fails closed when the allowlisted export exceeds its hard bound", async () => {
    const exports: AccountExportRepository = {
      get: vi.fn().mockResolvedValue({ type: "TOO_LARGE" }),
    };

    await expect(
      exportAccountData(
        {
          exports,
          session: { requireUserId: vi.fn().mockResolvedValue(userId) },
        },
        now,
      ),
    ).rejects.toEqual(new AccountExportError("SERVICE_UNAVAILABLE"));
  });
});

describe("account privacy HTTP boundaries", () => {
  const appUrl = new URL("https://storybridge.example");

  it("requires same-origin confirmation and idempotency before deletion", async () => {
    const deleteAccount = vi.fn().mockResolvedValue({
      deletionId,
      status: "QUEUED",
      statusToken,
    });
    const handler = createDeleteAccountHandler({ appUrl, deleteAccount });
    const response = await handler(
      new Request("https://storybridge.example/api/v1/me", {
        body: JSON.stringify({ confirmation: "DELETE" }),
        headers: {
          "content-type": "application/json",
          host: "storybridge.example",
          "idempotency-key": "delete-account-key-0001",
          origin: "https://storybridge.example",
        },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(202);
    expect(deleteAccount).toHaveBeenCalledWith("delete-account-key-0001");
  });

  it("downloads raw allowlisted JSON with non-cacheable attachment headers", async () => {
    const exportAccount = vi.fn().mockResolvedValue({
      data: {},
      exportedAt: now.toISOString(),
      profile: null,
      schemaVersion: "2026-08-10",
    });
    const response = await createAccountExportHandler({ exportAccount })();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "storybridge-data-2026-08-10.json",
    );
    expect(await response.json()).toEqual(await exportAccount());
  });

  it("accepts only a deletion-scoped bearer token for public status", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      completedAt: null,
      deletionId,
      requestedAt: now.toISOString(),
      status: "QUEUED",
    });
    const handler = createAccountDeletionStatusHandler({ getStatus });

    const missing = await handler(
      new Request("https://storybridge.example/api/v1/me/deletion"),
    );
    expect(missing.status).toBe(401);

    const response = await handler(
      new Request("https://storybridge.example/api/v1/me/deletion", {
        headers: { authorization: `DeletionStatus ${statusToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(getStatus).toHaveBeenCalledWith(statusToken);
  });

  it("requires a dedicated secret before invoking the deletion worker", async () => {
    const processNext = vi.fn().mockResolvedValue("IDLE");
    const handler = createAccountDeletionWorkerHandler({
      processNext,
      secret: "worker-secret-at-least-32-characters",
    });
    const denied = await handler(
      new Request(
        "https://storybridge.example/api/internal/account-deletions",
        {
          method: "POST",
        },
      ),
    );
    expect(denied.status).toBe(401);
    expect(processNext).not.toHaveBeenCalled();

    const accepted = await handler(
      new Request(
        "https://storybridge.example/api/internal/account-deletions",
        {
          headers: {
            authorization: "Bearer worker-secret-at-least-32-characters",
          },
          method: "POST",
        },
      ),
    );
    expect(accepted.status).toBe(200);
    expect(processNext).toHaveBeenCalledOnce();
  });
});
