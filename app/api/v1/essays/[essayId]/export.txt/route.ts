import { createDraftExportGetHandler } from "@/app/api/v1/essays/export-handler";
import { createEssayWorkspaceRuntime } from "@/app/api/v1/essays/runtime";
import { exportStudentDraft } from "@/services/export/export-draft";

type Context = { params: Promise<{ essayId: string }> };

export async function GET(_request: Request, context: Context) {
  const { dependencies } = await createEssayWorkspaceRuntime();
  const { essayId } = await context.params;
  return createDraftExportGetHandler({
    exportDraft: (parsedEssayId) =>
      exportStudentDraft(parsedEssayId, dependencies),
  })(essayId);
}
