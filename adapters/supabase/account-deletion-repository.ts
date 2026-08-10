import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import { accountDeletionIdSchema, userIdSchema } from "@/contracts/domain/ids";
import { accountDeletionStatusResponseSchema } from "@/contracts/http/v1/me";
import type { ServerConfig } from "@/lib/config/server";
import type {
  AccountDeletionRepository,
  AccountDeletionWorkerRepository,
} from "@/repositories/account-deletion-repository";

const queueSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.enum(["QUEUED", "REPLAY"]),
    deletion_id: accountDeletionIdSchema,
    requested_at: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({ decision: z.literal("CONFLICT") }),
]);

const statusSchema = z.strictObject({
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  deletion_id: accountDeletionIdSchema,
  requested_at: z.iso.datetime({ offset: true }),
  status: z.enum(["QUEUED", "PROCESSING", "COMPLETE", "FAILED"]),
});

const claimSchema = z.strictObject({
  attempt_count: z.number().int().min(1).max(5),
  deletion_id: accountDeletionIdSchema,
  status: z.literal("PROCESSING"),
  user_id: userIdSchema.nullable(),
  user_id_hmac: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
});

export function createSupabaseAccountDeletionRepository(
  config: ServerConfig,
): AccountDeletionRepository & AccountDeletionWorkerRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async claimNext(at) {
      const { data, error } = await client
        .schema("private")
        .rpc("claim_next_account_deletion", {
          requested_claimed_at: at.toISOString(),
        });
      if (error) throw error;
      if (data === null) return null;
      const row = claimSchema.parse(data);
      return {
        attemptCount: row.attempt_count,
        deletionId: row.deletion_id,
        userId: row.user_id,
        userIdHmac: row.user_id_hmac,
      };
    },
    async complete(deletionId, at) {
      const { data, error } = await client
        .schema("private")
        .rpc("complete_account_deletion", {
          requested_completed_at: at.toISOString(),
          requested_deletion_id: deletionId,
        });
      if (error) throw error;
      return data;
    },
    async fail(deletionId, safeFailureCode, at) {
      const { data, error } = await client
        .schema("private")
        .rpc("fail_account_deletion", {
          requested_deletion_id: deletionId,
          requested_failed_at: at.toISOString(),
          requested_safe_failure_code: safeFailureCode,
        });
      if (error) throw error;
      return data;
    },
    async getStatus(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("get_account_deletion_status", {
          requested_status_at: input.at.toISOString(),
          requested_status_token_hmac: input.statusTokenHmac,
        });
      if (error) throw error;
      if (data === null) return null;
      const row = statusSchema.parse(data);
      return accountDeletionStatusResponseSchema.parse({
        completedAt: row.completed_at,
        deletionId: row.deletion_id,
        requestedAt: row.requested_at,
        status: row.status,
      });
    },
    async prepare(deletionId) {
      const { data, error } = await client
        .schema("private")
        .rpc("prepare_account_deletion", {
          requested_deletion_id: deletionId,
        });
      if (error) throw error;
      return data;
    },
    async queue(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("queue_account_deletion", {
          requested_at: input.requestedAt.toISOString(),
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_status_token_hmac: input.statusTokenHmac,
          requested_user_id: input.userId,
          requested_user_id_hmac: input.userIdHmac,
        });
      if (error) throw error;
      const row = queueSchema.parse(data);
      if (row.decision === "CONFLICT") return { type: "CONFLICT" };
      return {
        deletionId: row.deletion_id,
        requestedAt: new Date(row.requested_at),
        type: row.decision,
      };
    },
  };
}

export function createSupabaseAccountIdentityProvider(config: ServerConfig) {
  const client = createSupabaseSecretClient(config);
  return {
    async deleteUser(userId: z.infer<typeof userIdSchema>) {
      const { error } = await client.auth.admin.deleteUser(userId, false);
      if (error) throw error;
    },
  };
}
