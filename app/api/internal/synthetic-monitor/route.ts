import { createSyntheticMonitorHandler } from "@/app/api/internal/synthetic-monitor/handler";
import { parseServerConfig } from "@/lib/config/server";
import { serverLogger } from "@/lib/observability/logger";

export async function POST(request: Request): Promise<Response> {
  const config = parseServerConfig(process.env);
  return createSyntheticMonitorHandler({
    logger: serverLogger,
    secret: config.internalOperationsSecret,
  })(request);
}
