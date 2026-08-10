import type { UserId } from "@/contracts/domain/ids";
import {
  accountDeletionStatusResponseSchema,
  deletionRequestSchema,
  deletionStatusTokenSchema,
  type AccountDeletionStatusResponse,
  type DeletionRequest,
} from "@/contracts/http/v1/me";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { AccountDeletionRepository } from "@/repositories/account-deletion-repository";
import { requirePrivacyAccess } from "@/services/auth/eligibility";

type AccountLifecycleErrorCode = Extract<
  ErrorCode,
  "RESOURCE_NOT_FOUND" | "STATE_CONFLICT"
>;

export class AccountLifecycleError extends Error {
  readonly code: AccountLifecycleErrorCode;

  constructor(code: AccountLifecycleErrorCode) {
    super(code);
    this.name = "AccountLifecycleError";
    this.code = code;
  }
}

type AccountDeletionTokens = {
  hashStatusToken(statusToken: string): string;
  issue(
    userId: UserId,
    idempotencyKey: string,
  ): {
    idempotencyKeyHmac: string;
    statusToken: string;
    statusTokenHmac: string;
    userIdHmac: string;
  };
};

type AccountDeletionDependencies = {
  deletions: AccountDeletionRepository;
  session: {
    requireUserId(): Promise<UserId>;
    revokeAll(): Promise<void>;
  };
  tokens: AccountDeletionTokens;
};

export async function requestAccountDeletion(
  dependencies: AccountDeletionDependencies,
  idempotencyKey: string,
  now = new Date(),
): Promise<DeletionRequest> {
  const userId = await requirePrivacyAccess(dependencies.session);
  const token = dependencies.tokens.issue(userId, idempotencyKey);
  const result = await dependencies.deletions.queue({
    idempotencyKeyHmac: token.idempotencyKeyHmac,
    requestedAt: now,
    statusTokenHmac: token.statusTokenHmac,
    userId,
    userIdHmac: token.userIdHmac,
  });
  if (result.type === "CONFLICT") {
    throw new AccountLifecycleError("STATE_CONFLICT");
  }
  await dependencies.session.revokeAll();
  return deletionRequestSchema.parse({
    deletionId: result.deletionId,
    status: "QUEUED",
    statusToken: token.statusToken,
  });
}

export async function getAccountDeletionStatus(
  rawStatusToken: string,
  dependencies: Pick<AccountDeletionDependencies, "deletions" | "tokens">,
  now = new Date(),
): Promise<AccountDeletionStatusResponse> {
  const statusToken = deletionStatusTokenSchema.parse(rawStatusToken);
  const value = await dependencies.deletions.getStatus({
    at: now,
    statusTokenHmac: dependencies.tokens.hashStatusToken(statusToken),
  });
  if (!value) throw new AccountLifecycleError("RESOURCE_NOT_FOUND");
  return accountDeletionStatusResponseSchema.parse(value);
}
