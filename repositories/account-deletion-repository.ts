import type { AccountDeletionId, UserId } from "@/contracts/domain/ids";
import type { AccountDeletionStatusResponse } from "@/contracts/http/v1/me";

type QueuedDeletion = {
  deletionId: AccountDeletionId;
  requestedAt: Date;
  type: "QUEUED" | "REPLAY";
};

export interface AccountDeletionRepository {
  getStatus(input: {
    at: Date;
    statusTokenHmac: string;
  }): Promise<AccountDeletionStatusResponse | null>;
  queue(input: {
    idempotencyKeyHmac: string;
    requestedAt: Date;
    statusTokenHmac: string;
    userId: UserId;
    userIdHmac: string;
  }): Promise<QueuedDeletion | { type: "CONFLICT" }>;
}

export type ClaimedAccountDeletion = {
  attemptCount: number;
  deletionId: AccountDeletionId;
  userId: UserId | null;
  userIdHmac: string;
};

export interface AccountDeletionWorkerRepository {
  claimNext(at: Date): Promise<ClaimedAccountDeletion | null>;
  complete(deletionId: AccountDeletionId, at: Date): Promise<boolean>;
  fail(
    deletionId: AccountDeletionId,
    safeFailureCode: string,
    at: Date,
  ): Promise<boolean>;
  prepare(deletionId: AccountDeletionId): Promise<boolean>;
}
