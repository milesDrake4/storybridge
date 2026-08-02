import { isIP } from "node:net";

import { z } from "zod";

import type { AiPurpose } from "@/contracts/domain/ai-ports";
import type { AiOperationId, EssayId, UserId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { HmacSecrets } from "@/lib/config/server";
import {
  createContentHmac,
  createIdempotencyHmac,
  createIpHmac,
} from "@/lib/security/hmac";
import type {
  AiOperationRepository,
  AiOperationReservation,
  FinalizeAiOperationRecord,
} from "@/repositories/ai-operation-repository";

type AiOperationErrorCode = Extract<
  ErrorCode,
  | "IDEMPOTENCY_KEY_REUSED"
  | "QUOTA_EXCEEDED"
  | "BETA_CAP_REACHED"
  | "AI_BUDGET_EXHAUSTED"
  | "STATE_CONFLICT"
  | "SERVICE_UNAVAILABLE"
>;

export class AiOperationError extends Error {
  readonly code: AiOperationErrorCode;
  readonly resetAt?: Date;

  constructor(code: AiOperationErrorCode, resetAt?: Date) {
    super(code);
    this.name = "AiOperationError";
    this.code = code;
    this.resetAt = resetAt;
  }
}

const reserveInputSchema = z.object({
  canonicalRequest: z.string().min(1).max(65_536),
  estimatedCostCents: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(256),
  method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
  route: z
    .string()
    .max(200)
    .regex(/^\/api\/v1\/[A-Za-z0-9_./{}-]+$/),
});

export type ReserveAiOperationInput = {
  canonicalRequest: string;
  essayId?: EssayId;
  estimatedCostCents: number;
  idempotencyKey: string;
  ipAddress: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  purpose: AiPurpose;
  route: string;
  userId: UserId;
};

type ReservationDependencies = {
  hmacSecrets: HmacSecrets;
  limits: {
    betaAccountCap: number;
    dailyAiCallLimit: number;
    monthlyOpenAiBudgetCents: number;
  };
  now?: () => Date;
  repository: AiOperationRepository;
};

function throwForDenial(
  reservation: Exclude<AiOperationReservation, { type: "RESERVED" | "REPLAY" }>,
): never {
  const codeByDecision = {
    BETA_CAP_REACHED: "BETA_CAP_REACHED",
    BUDGET_EXHAUSTED: "AI_BUDGET_EXHAUSTED",
    FALLBACK_LIMIT_REACHED: "QUOTA_EXCEEDED",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED",
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  } as const satisfies Record<typeof reservation.type, AiOperationErrorCode>;
  throw new AiOperationError(
    codeByDecision[reservation.type],
    reservation.resetAt,
  );
}

export async function reserveAiOperation(
  input: ReserveAiOperationInput,
  dependencies: ReservationDependencies,
): Promise<Extract<AiOperationReservation, { type: "RESERVED" | "REPLAY" }>> {
  const parsed = reserveInputSchema.parse(input);
  if (!isIP(input.ipAddress)) {
    throw new AiOperationError("STATE_CONFLICT");
  }
  const now = dependencies.now?.() ?? new Date();
  const reservation = await dependencies.repository.reserve({
    betaAccountCap: dependencies.limits.betaAccountCap,
    dailyLimit: dependencies.limits.dailyAiCallLimit,
    ...(input.essayId ? { essayId: input.essayId } : {}),
    estimatedCostCents: parsed.estimatedCostCents,
    idempotencyKeyHmac: createIdempotencyHmac(
      parsed.idempotencyKey,
      dependencies.hmacSecrets,
    ),
    ipHmac: createIpHmac(input.ipAddress, dependencies.hmacSecrets, now),
    method: parsed.method,
    monthlyBudgetCents: dependencies.limits.monthlyOpenAiBudgetCents,
    now,
    purpose: input.purpose,
    requestHmac: createContentHmac(
      parsed.canonicalRequest,
      dependencies.hmacSecrets,
    ),
    route: parsed.route,
    userId: input.userId,
  });

  if (reservation.type === "RESERVED" || reservation.type === "REPLAY") {
    return reservation;
  }
  return throwForDenial(reservation);
}

export async function startAiOperation(
  operationId: AiOperationId,
  repository: AiOperationRepository,
  now = new Date(),
): Promise<void> {
  const result = await repository.start(operationId, now);
  if (result === "STARTED") return;
  if (result === "FALLBACK_LIMIT_REACHED") {
    throw new AiOperationError("QUOTA_EXCEEDED");
  }
  if (result === "RESERVATION_EXPIRED") {
    throw new AiOperationError("SERVICE_UNAVAILABLE");
  }
  throw new AiOperationError("STATE_CONFLICT");
}

export async function releaseAiOperation(
  operationId: AiOperationId,
  safeErrorCode: string,
  httpStatus: number,
  repository: AiOperationRepository,
  now = new Date(),
): Promise<void> {
  if (
    !(await repository.release(operationId, safeErrorCode, httpStatus, now))
  ) {
    throw new AiOperationError("STATE_CONFLICT");
  }
}

export async function finalizeAiOperation(
  input: Omit<FinalizeAiOperationRecord, "now">,
  repository: AiOperationRepository,
  now = new Date(),
): Promise<void> {
  if (!(await repository.finalize({ ...input, now }))) {
    throw new AiOperationError("STATE_CONFLICT");
  }
}
