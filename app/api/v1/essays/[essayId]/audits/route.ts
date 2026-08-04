import { createAuditPostHandler } from "@/app/api/v1/essays/audit-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { auditEssay } from "@/services/audit/audit-essay";

type Context = { params: Promise<{ essayId: string }> };

export async function POST(request: Request, context: Context) {
  const { config, dependencies } = await createEssayWorkspaceRuntime();
  const { essayId } = await context.params;
  return createAuditPostHandler({
    appUrl: config.appUrl,
    audit: (parsedEssayId, metadata) =>
      auditEssay(parsedEssayId, metadata, dependencies),
  })(request, essayId);
}
