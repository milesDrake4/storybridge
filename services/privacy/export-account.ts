import type { AccountExport } from "@/contracts/http/v1/me";
import type { ErrorCode } from "@/contracts/http/v1/errors";
import type { AccountExportRepository } from "@/repositories/account-export-repository";
import { requirePrivacyAccess } from "@/services/auth/eligibility";

export const MAX_ACCOUNT_EXPORT_BYTES = 5 * 1024 * 1024;

type AccountExportErrorCode = Extract<ErrorCode, "SERVICE_UNAVAILABLE">;

export class AccountExportError extends Error {
  readonly code: AccountExportErrorCode;

  constructor(code: AccountExportErrorCode) {
    super(code);
    this.name = "AccountExportError";
    this.code = code;
  }
}

export async function exportAccountData(
  dependencies: {
    exports: AccountExportRepository;
    session: {
      requireUserId(): Promise<import("@/contracts/domain/ids").UserId>;
    };
  },
  now = new Date(),
): Promise<AccountExport> {
  const userId = await requirePrivacyAccess(dependencies.session);
  const result = await dependencies.exports.get({
    at: now,
    maxBytes: MAX_ACCOUNT_EXPORT_BYTES,
    userId,
  });
  if (result.type === "TOO_LARGE") {
    throw new AccountExportError("SERVICE_UNAVAILABLE");
  }
  return result.export;
}
