import type { UserId } from "@/contracts/domain/ids";
import type { AccountExport } from "@/contracts/http/v1/me";

export interface AccountExportRepository {
  get(input: {
    at: Date;
    maxBytes: number;
    userId: UserId;
  }): Promise<{ export: AccountExport; type: "READY" } | { type: "TOO_LARGE" }>;
}
