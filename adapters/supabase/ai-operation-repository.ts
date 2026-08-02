import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  aiOperationIdSchema,
  canonicalUuidSchema,
} from "@/contracts/domain/ids";
import type { ServerConfig } from "@/lib/config/server";
import type {
  AiOperationRepository,
  AiOperationReservation,
} from "@/repositories/ai-operation-repository";

const operationStatusSchema = z.enum([
  "RESERVED",
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "REFUSED",
  "UNKNOWN",
]);

const reservationRowSchema = z.object({
  decision: z.enum([
    "RESERVED",
    "REPLAY",
    "IDEMPOTENCY_CONFLICT",
    "QUOTA_EXCEEDED",
    "BETA_CAP_REACHED",
    "BUDGET_EXHAUSTED",
    "FALLBACK_LIMIT_REACHED",
  ]),
  operation_id: aiOperationIdSchema.nullable(),
  operation_status: operationStatusSchema.nullable(),
  original_http_status: z.number().int().min(100).max(599).nullable(),
  reset_at: z.iso.datetime({ offset: true }),
  result_resource_id: canonicalUuidSchema.nullable(),
  result_resource_type: z.string().min(1).max(50).nullable(),
});

const startResultSchema = z.enum([
  "STARTED",
  "ALREADY_STARTED",
  "NOT_FOUND",
  "INVALID_STATE",
  "RESERVATION_EXPIRED",
  "FALLBACK_LIMIT_REACHED",
]);

function mapReservation(value: unknown): AiOperationReservation {
  const row = reservationRowSchema.parse(value);
  const resetAt = new Date(row.reset_at);
  if (row.decision === "RESERVED") {
    return {
      operationId: aiOperationIdSchema.parse(row.operation_id),
      resetAt,
      type: "RESERVED",
    };
  }
  if (row.decision === "REPLAY") {
    const resource =
      row.result_resource_id && row.result_resource_type
        ? { id: row.result_resource_id, type: row.result_resource_type }
        : null;
    return {
      operationId: aiOperationIdSchema.parse(row.operation_id),
      originalHttpStatus: row.original_http_status,
      resetAt,
      resource,
      status: operationStatusSchema.parse(row.operation_status),
      type: "REPLAY",
    };
  }
  return { resetAt, type: row.decision };
}

export function createSupabaseAiOperationRepository(
  config: ServerConfig,
): AiOperationRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async reserve(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("reserve_ai_operation", {
          requested_at: input.now.toISOString(),
          requested_beta_account_cap: input.betaAccountCap,
          requested_daily_limit: input.dailyLimit,
          requested_essay_id: input.essayId ?? null,
          requested_estimated_cost_cents: input.estimatedCostCents,
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_ip_hmac: input.ipHmac,
          requested_method: input.method,
          requested_monthly_budget_cents: input.monthlyBudgetCents,
          requested_purpose: input.purpose,
          requested_request_hmac: input.requestHmac,
          requested_route: input.route,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      return mapReservation(data?.[0]);
    },
    async start(operationId, now) {
      const { data, error } = await client
        .schema("private")
        .rpc("start_ai_operation", {
          requested_at: now.toISOString(),
          requested_operation_id: operationId,
        });
      if (error) throw error;
      return startResultSchema.parse(data);
    },
    async release(operationId, safeErrorCode, httpStatus, now) {
      const { data, error } = await client
        .schema("private")
        .rpc("release_ai_operation", {
          requested_at: now.toISOString(),
          requested_http_status: httpStatus,
          requested_operation_id: operationId,
          requested_safe_error_code: safeErrorCode,
        });
      if (error) throw error;
      return z.boolean().parse(data);
    },
    async finalize(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("finalize_ai_operation", {
          requested_at: input.now.toISOString(),
          requested_final_cost_cents: input.finalCostCents,
          requested_http_status: input.httpStatus,
          requested_input_tokens: input.inputTokens,
          requested_latency_ms: input.latencyMs,
          requested_model_id: input.modelId,
          requested_operation_id: input.operationId,
          requested_output_tokens: input.outputTokens,
          requested_provider_request_id: input.providerRequestId,
          requested_result_resource_id: input.resource?.id ?? null,
          requested_result_resource_type: input.resource?.type ?? null,
          requested_safe_error_code: input.safeErrorCode ?? null,
          requested_status: input.status,
        });
      if (error) throw error;
      return z.boolean().parse(data);
    },
  };
}
