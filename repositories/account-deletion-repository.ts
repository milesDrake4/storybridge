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
