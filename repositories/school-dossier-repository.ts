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
  | { type: "CREATED" | "REPLAY"; value: SchoolDossier }
  | { type: "NOT_FOUND" }
  | { type: "STATE_CONFLICT" };

export interface SchoolDossierRepository {
  commit(input: {
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
  }): Promise<CommitSchoolDossierDecision>;
  findByEssay(userId: UserId, essayId: EssayId): Promise<SchoolDossier | null>;
  findById(
    userId: UserId,
    dossierId: SchoolDossierId,
  ): Promise<SchoolDossier | null>;
}
