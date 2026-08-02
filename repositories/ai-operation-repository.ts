import type { AiPurpose } from "@/contracts/domain/ai-ports";
import type { AiOperationId, EssayId, UserId } from "@/contracts/domain/ids";
import type { ContentHmac, IdempotencyHmac, IpHmac } from "@/lib/security/hmac";

export type AiOperationStatus =
  | "RESERVED"
  | "STARTED"
  | "SUCCEEDED"
  | "FAILED"
  | "REFUSED"
  | "UNKNOWN";

export type ReserveAiOperationRecord = {
  betaAccountCap: number;
  dailyLimit: number;
  estimatedCostCents: number;
  idempotencyKeyHmac: IdempotencyHmac;
  ipHmac: IpHmac;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  monthlyBudgetCents: number;
  now: Date;
  purpose: AiPurpose;
  requestHmac: ContentHmac;
  route: string;
  userId: UserId;
  essayId?: EssayId;
};

type ReservationDenial = {
  resetAt: Date;
  type:
    | "IDEMPOTENCY_CONFLICT"
    | "QUOTA_EXCEEDED"
    | "BETA_CAP_REACHED"
    | "BUDGET_EXHAUSTED"
    | "FALLBACK_LIMIT_REACHED";
};

export type AiOperationReservation =
  | {
      operationId: AiOperationId;
      resetAt: Date;
      type: "RESERVED";
    }
  | {
      operationId: AiOperationId;
      originalHttpStatus: number | null;
      resetAt: Date;
      resource: { id: string; type: string } | null;
      status: AiOperationStatus;
      type: "REPLAY";
    }
  | ReservationDenial;

export type FinalizeAiOperationRecord = {
  finalCostCents: number;
  httpStatus: number;
  inputTokens: number | null;
  latencyMs: number;
  modelId: string | null;
  now: Date;
  operationId: AiOperationId;
  outputTokens: number | null;
  providerRequestId: string | null;
  safeErrorCode?: string;
  status: "SUCCEEDED" | "FAILED" | "REFUSED" | "UNKNOWN";
  resource?: { id: string; type: string };
};

export interface AiOperationRepository {
  reserve(input: ReserveAiOperationRecord): Promise<AiOperationReservation>;
  start(
    operationId: AiOperationId,
    now: Date,
  ): Promise<
    | "STARTED"
    | "ALREADY_STARTED"
    | "NOT_FOUND"
    | "INVALID_STATE"
    | "RESERVATION_EXPIRED"
    | "FALLBACK_LIMIT_REACHED"
  >;
  release(
    operationId: AiOperationId,
    safeErrorCode: string,
    httpStatus: number,
    now: Date,
  ): Promise<boolean>;
  finalize(input: FinalizeAiOperationRecord): Promise<boolean>;
}
