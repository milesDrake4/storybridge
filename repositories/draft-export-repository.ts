import type { EssayId, UserId } from "@/contracts/domain/ids";

export type DraftExportDecision =
  | { draftText: string; type: "EXPORTABLE" }
  | { type: "BLOCKED" }
  | { type: "NOT_FOUND" };

export interface DraftExportRepository {
  get(userId: UserId, essayId: EssayId): Promise<DraftExportDecision>;
}
