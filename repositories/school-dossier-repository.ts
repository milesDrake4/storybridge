import type {
  SchoolDossierDraft,
  SchoolDossier,
} from "@/contracts/domain/school-dossier";
import type {
  AiOperationId,
  EssayId,
  SchoolDossierId,
  UserId,
} from "@/contracts/domain/ids";

export type CommitSchoolDossierDecision =
  | {
      essayRevision: number;
      type: "CREATED" | "REPLAY";
      value: SchoolDossier;
    }
  | { type: "NOT_FOUND" }
  | { type: "REVISION_MISMATCH" }
  | { type: "STATE_CONFLICT" };

export type SchoolDossierCommitInput = {
  draft: SchoolDossierDraft;
  essayId: EssayId;
  finalCostCents: number;
  inputTokens: number;
  latencyMs: number;
  modelId: string;
  now: Date;
  operationId: AiOperationId;
  outputTokens: number;
  providerRequestId: string;
  userId: UserId;
};

export interface SchoolDossierRepository {
  commit(input: SchoolDossierCommitInput): Promise<CommitSchoolDossierDecision>;
  findByEssay(userId: UserId, essayId: EssayId): Promise<SchoolDossier | null>;
  findById(
    userId: UserId,
    dossierId: SchoolDossierId,
  ): Promise<SchoolDossier | null>;
  refresh(
    input: SchoolDossierCommitInput & { expectedRevision: number },
  ): Promise<CommitSchoolDossierDecision>;
}
