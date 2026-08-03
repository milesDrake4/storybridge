import type {
  EssayAngle,
  EssayAngleDraft,
  EssayAnglePatch,
} from "@/contracts/domain/essay-angle";
import type {
  AiOperationId,
  EssayAngleId,
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
  select(input: {
    angleId: EssayAngleId;
    essayId: EssayId;
    now: Date;
    userId: UserId;
  }): Promise<
    { type: "NOT_FOUND" | "STATE_CONFLICT" } | { type: "REPLAY" | "SELECTED" }
  >;
  update(input: {
    angleId: EssayAngleId;
    essayId: EssayId;
    expectedRevision: number;
    now: Date;
    patch: EssayAnglePatch;
    userId: UserId;
  }): Promise<
    | { type: "NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT" }
    | { type: "UPDATED" }
  >;
}
