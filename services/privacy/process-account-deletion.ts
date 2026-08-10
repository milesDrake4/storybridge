import type { UserId } from "@/contracts/domain/ids";
import type { AccountDeletionWorkerRepository } from "@/repositories/account-deletion-repository";

type AccountIdentityProvider = {
  deleteUser(userId: UserId): Promise<void>;
};

type AccountDeletionWorkerDependencies = {
  deletions: AccountDeletionWorkerRepository;
  provider: AccountIdentityProvider;
};

export type AccountDeletionWorkerResult = "IDLE" | "COMPLETE" | "FAILED";

export async function processNextAccountDeletion(
  dependencies: AccountDeletionWorkerDependencies,
  now = new Date(),
): Promise<AccountDeletionWorkerResult> {
  const claimed = await dependencies.deletions.claimNext(now);
  if (!claimed) return "IDLE";

  if (claimed.userId) {
    const prepared = await dependencies.deletions.prepare(claimed.deletionId);
    if (!prepared) {
      await dependencies.deletions.fail(
        claimed.deletionId,
        "PREPARATION_FAILED",
        now,
      );
      return "FAILED";
    }
    try {
      await dependencies.provider.deleteUser(claimed.userId);
    } catch {
      if (claimed.attemptCount < 5) {
        throw new Error("ACCOUNT_DELETION_PROVIDER_RETRY");
      }
      await dependencies.deletions.fail(
        claimed.deletionId,
        "PROVIDER_DELETE_FAILED",
        now,
      );
      return "FAILED";
    }
  }

  const completed = await dependencies.deletions.complete(
    claimed.deletionId,
    now,
  );
  if (!completed) throw new Error("ACCOUNT_DELETION_COMPLETION_CONFLICT");
  return "COMPLETE";
}
