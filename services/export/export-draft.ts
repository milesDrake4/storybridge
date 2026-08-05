import type { EssayId } from "@/contracts/domain/ids";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import { normalizePlainText } from "@/lib/security/request-boundary";
import type { DraftExportRepository } from "@/repositories/draft-export-repository";
import {
  requirePrivacyAccess,
  type AuthenticatedSession,
} from "@/services/auth/eligibility";

type ExportStudentDraftErrorCode = Extract<
  ErrorCode,
  "EXPORT_BLOCKED" | "RESOURCE_NOT_FOUND"
>;

export class ExportStudentDraftError extends Error {
  readonly code: ExportStudentDraftErrorCode;

  constructor(code: ExportStudentDraftErrorCode) {
    super(code);
    this.name = "ExportStudentDraftError";
    this.code = code;
  }
}

export async function exportStudentDraft(
  essayId: EssayId,
  dependencies: {
    exports: DraftExportRepository;
    session: AuthenticatedSession;
  },
): Promise<string> {
  const userId = await requirePrivacyAccess(dependencies.session);
  const result = await dependencies.exports.get(userId, essayId);
  if (result.type === "NOT_FOUND") {
    throw new ExportStudentDraftError("RESOURCE_NOT_FOUND");
  }
  if (result.type === "BLOCKED") {
    throw new ExportStudentDraftError("EXPORT_BLOCKED");
  }
  return normalizePlainText(result.draftText);
}
