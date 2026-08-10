import type { ErrorCode } from "@/contracts/http/v1/errors";
import {
  operatorAlertSchema,
  type OperatorAlert,
} from "@/lib/observability/logger";

export function alertForApplicationError(
  errorCode: ErrorCode,
  requestId: string,
): OperatorAlert | null {
  if (errorCode !== "AI_BUDGET_EXHAUSTED" && errorCode !== "BETA_CAP_REACHED") {
    return null;
  }
  return operatorAlertSchema.parse({
    alertKind: errorCode,
    event: "operator_alert",
    level: "error",
    requestId,
    severity: errorCode === "AI_BUDGET_EXHAUSTED" ? "PAGE" : "TICKET",
  });
}

export function createWebhookRetryAlert(requestId: string): OperatorAlert {
  return operatorAlertSchema.parse({
    alertKind: "WEBHOOK_RETRY_PENDING",
    event: "operator_alert",
    level: "error",
    requestId,
    severity: "TICKET",
  });
}
