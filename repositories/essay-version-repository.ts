import type { AiProposalId, EssayId, UserId } from "@/contracts/domain/ids";
import type { Essay, EssayStatus } from "@/contracts/http/v1/essays";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";

export type EssayVersionOrigin =
  | "ACCEPTED_PROPOSAL"
  | "AUTOSAVE"
  | "MANUAL_SNAPSHOT";

export interface EssayVersionRepository {
  save(input: {
    acceptedProposalId: AiProposalId | null;
    draftText?: string;
    essayId: EssayId;
    expectedRevision: number;
    now: Date;
    outline?: OutlineV1;
    origin: EssayVersionOrigin;
    status?: EssayStatus;
    userId: UserId;
  }): Promise<
    | {
        type: "NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT";
      }
    | { type: "UNCHANGED" | "UPDATED"; value: Essay }
  >;
}
