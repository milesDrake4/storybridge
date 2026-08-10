import { describe, expect, it, vi } from "vitest";

import { createSyntheticMonitorHandler } from "@/app/api/internal/synthetic-monitor/handler";
import {
  createStructuredLogger,
  safeLogEventSchema,
} from "@/lib/observability/logger";
import {
  alertForApplicationError,
  createWebhookRetryAlert,
} from "@/services/observability/alerts";
import { runSyntheticMonitor } from "@/services/observability/synthetic-monitor";

const requestId = "ff000000-0000-4000-8000-000000000001";

describe("safe structured logging", () => {
  it("correlates safe errors without accepting provider text or request bodies", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      write: (line) => lines.push(line),
    });
    logger.write({
      errorCode: "SERVICE_UNAVAILABLE",
      event: "request_failed",
      level: "error",
      requestId,
    });

    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      errorCode: "SERVICE_UNAVAILABLE",
      event: "request_failed",
      level: "error",
      requestId,
    });
    expect(() =>
      safeLogEventSchema.parse({
        errorCode: "SERVICE_UNAVAILABLE",
        event: "request_failed",
        level: "error",
        providerMessage: "private provider response",
        requestId,
      }),
    ).toThrow();
  });

  it("creates content-free alerts for budget, cap, and webhook retries", () => {
    expect(
      alertForApplicationError("AI_BUDGET_EXHAUSTED", requestId),
    ).toMatchObject({
      alertKind: "AI_BUDGET_EXHAUSTED",
      event: "operator_alert",
      requestId,
    });
    expect(
      alertForApplicationError("BETA_CAP_REACHED", requestId),
    ).toMatchObject({
      alertKind: "BETA_CAP_REACHED",
    });
    expect(createWebhookRetryAlert(requestId)).toMatchObject({
      alertKind: "WEBHOOK_RETRY_PENDING",
    });
    expect(alertForApplicationError("VALIDATION_ERROR", requestId)).toBeNull();
  });

  it("emits a bounded synthetic health result without user content", async () => {
    const write = vi.fn();
    const logger = createStructuredLogger({ write });

    await expect(
      runSyntheticMonitor(
        {
          check: "APPLICATION_HEALTH",
          probe: vi.fn().mockResolvedValue(undefined),
        },
        { logger, requestId },
      ),
    ).resolves.toBe("PASS");
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? "{}")).toEqual({
      check: "APPLICATION_HEALTH",
      event: "synthetic_monitor",
      level: "info",
      requestId,
      status: "PASS",
    });
  });

  it("exposes an authenticated content-free error-pipeline hook", async () => {
    const write = vi.fn();
    const handler = createSyntheticMonitorHandler({
      logger: createStructuredLogger({ write }),
      secret: "synthetic-secret-at-least-32-characters",
    });
    const denied = await handler(
      new Request(
        "https://storybridge.example/api/internal/synthetic-monitor",
        {
          method: "POST",
        },
      ),
    );
    expect(denied.status).toBe(401);

    const accepted = await handler(
      new Request(
        "https://storybridge.example/api/internal/synthetic-monitor",
        {
          headers: {
            authorization: "Bearer synthetic-secret-at-least-32-characters",
            "x-request-id": requestId,
          },
          method: "POST",
        },
      ),
    );
    expect(accepted.status).toBe(202);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      check: "ERROR_PIPELINE",
      requestId,
      status: "FAIL",
    });
  });
});
