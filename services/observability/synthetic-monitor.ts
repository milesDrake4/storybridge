import type { StructuredLogger } from "@/lib/observability/logger";

export async function runSyntheticMonitor(
  input: {
    check: "APPLICATION_HEALTH" | "ERROR_PIPELINE";
    probe(): Promise<void>;
  },
  dependencies: { logger: StructuredLogger; requestId: string },
): Promise<"PASS" | "FAIL"> {
  try {
    await input.probe();
    dependencies.logger.write({
      check: input.check,
      event: "synthetic_monitor",
      level: "info",
      requestId: dependencies.requestId,
      status: "PASS",
    });
    return "PASS";
  } catch {
    dependencies.logger.write({
      check: input.check,
      event: "synthetic_monitor",
      level: "error",
      requestId: dependencies.requestId,
      status: "FAIL",
    });
    return "FAIL";
  }
}
