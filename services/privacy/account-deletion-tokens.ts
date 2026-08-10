import type { UserId } from "@/contracts/domain/ids";
import type { HmacSecrets } from "@/lib/config/server";
import {
  createAccountDeletionStatusToken,
  createAccountDeletionStatusTokenHmac,
  createAccountDeletionUserHmac,
  createIdempotencyHmac,
} from "@/lib/security/hmac";

export function createAccountDeletionTokens(secrets: HmacSecrets) {
  return {
    hashStatusToken(statusToken: string) {
      return createAccountDeletionStatusTokenHmac(statusToken, secrets);
    },
    issue(userId: UserId, idempotencyKey: string) {
      const statusToken = createAccountDeletionStatusToken(
        userId,
        idempotencyKey,
        secrets,
      );
      return {
        idempotencyKeyHmac: createIdempotencyHmac(
          `account-deletion:${idempotencyKey}`,
          secrets,
        ),
        statusToken,
        statusTokenHmac: createAccountDeletionStatusTokenHmac(
          statusToken,
          secrets,
        ),
        userIdHmac: createAccountDeletionUserHmac(userId, secrets),
      };
    },
  };
}
