import { essayIdSchema, type EssayId } from "@/contracts/domain/ids";
import { createErrorResponse } from "@/lib/http/respond";
import { EligibilityError } from "@/services/auth/eligibility";
import { ExportStudentDraftError } from "@/services/export/export-draft";

export function createDraftExportGetHandler(dependencies: {
  exportDraft(essayId: EssayId): Promise<string>;
}) {
  return async function getDraftExport(rawEssayId: string): Promise<Response> {
    try {
      const essayId = essayIdSchema.safeParse(rawEssayId);
      if (!essayId.success) {
        throw new ExportStudentDraftError("RESOURCE_NOT_FOUND");
      }
      const draft = await dependencies.exportDraft(essayId.data);
      return new Response(draft, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": 'attachment; filename="storybridge-essay.txt"',
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
    } catch (error) {
      if (
        error instanceof EligibilityError ||
        error instanceof ExportStudentDraftError
      ) {
        return createErrorResponse(error.code);
      }
      return createErrorResponse("INTERNAL_ERROR");
    }
  };
}
