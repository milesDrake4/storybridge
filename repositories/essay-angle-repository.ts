import type {
  EssayAngle,
  EssayAngleDraft,
} from "@/contracts/domain/essay-angle";
import type {
  AiOperationId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";

export type CommitEssayAnglesDecision =
  | { type: "CREATED" | "REPLAY"; value: [EssayAngle, EssayAngle, EssayAngle] }
  | {
      type:
        | "DOSSIER_CHANGED"
        | "EVIDENCE_INVALID"
        | "NOT_FOUND"
        | "REGENERATION_USED"
        | "STATE_CONFLICT";
    };

export interface EssayAngleRepository {
  commit(input: {
    angles: [EssayAngleDraft, EssayAngleDraft, EssayAngleDraft];
    dossierId: SchoolDossierId;
    essayId: EssayId;
    finalCostCents: number;
    inputTokens: number;
    latencyMs: number;
    modelId: string;
    now: Date;
    operationId: AiOperationId;
    outputTokens: number;
    providerRequestId: string;
    regenerate: boolean;
    userId: UserId;
  }): Promise<CommitEssayAnglesDecision>;
  list(userId: UserId, essayId: EssayId): Promise<EssayAngle[]>;
}
