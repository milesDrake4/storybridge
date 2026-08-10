import { describe, expect, it, vi } from "vitest";

import type { AccountDeletionId, UserId } from "@/contracts/domain/ids";
import {
  deleteAccountInputSchema,
  deletionRequestSchema,
  deletionStatusTokenSchema,
} from "@/contracts/http/v1/me";
import type { AccountDeletionRepository } from "@/repositories/account-deletion-repository";
import {
  AccountLifecycleError,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from "@/services/privacy/delete-account";

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
