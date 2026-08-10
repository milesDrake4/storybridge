import { z } from "zod";

import { aiProviderMetricSchema } from "@/contracts/domain/analytics";
import { canonicalUuidSchema } from "@/contracts/domain/ids";
import { errorCodeSchema } from "@/contracts/http/v1/errors";

const requestFailedSchema = z.strictObject({
  errorCode: errorCodeSchema,
  event: z.literal("request_failed"),
  level: z.enum(["warn", "error"]),
  requestId: canonicalUuidSchema,
});

const aiMetricLogSchema = aiProviderMetricSchema.extend({
  event: z.literal("ai_provider_operation"),
  level: z.enum(["info", "warn", "error"]),
  requestId: canonicalUuidSchema,
});

export const operatorAlertSchema = z.strictObject({
  alertKind: z.enum([
    "AI_BUDGET_EXHAUSTED",
    "BETA_CAP_REACHED",
    "WEBHOOK_RETRY_PENDING",
  ]),
  event: z.literal("operator_alert"),
  level: z.literal("error"),
  requestId: canonicalUuidSchema,
  severity: z.enum(["PAGE", "TICKET"]),
});
export type OperatorAlert = z.infer<typeof operatorAlertSchema>;

const syntheticMonitorSchema = z.strictObject({
  check: z.enum(["APPLICATION_HEALTH", "ERROR_PIPELINE"]),
  event: z.literal("synthetic_monitor"),
  level: z.enum(["info", "error"]),
  requestId: canonicalUuidSchema,
  status: z.enum(["PASS", "FAIL"]),
});

export const safeLogEventSchema = z.discriminatedUnion("event", [
  requestFailedSchema,
  aiMetricLogSchema,
  operatorAlertSchema,
  syntheticMonitorSchema,
]);
export type SafeLogEvent = z.infer<typeof safeLogEventSchema>;

export type StructuredLogger = {
  write(event: SafeLogEvent): void;
};

export function createStructuredLogger(sink: { write(line: string): void }) {
  return {
    write(event: SafeLogEvent): void {
      const parsed = safeLogEventSchema.parse(event);
      sink.write(`${JSON.stringify(parsed)}\n`);
    },
  } satisfies StructuredLogger;
}

export const serverLogger = createStructuredLogger({
  write(line) {
    process.stderr.write(line);
  },
});
