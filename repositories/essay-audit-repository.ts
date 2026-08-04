import type {
  EssayAuditId,
  EssayId,
  ProposalClaimId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  AuditIssue,
  EssayAudit,
  SimilarityMetrics,
} from "@/contracts/http/v1/audits";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export type AuditContext = {
  essay: {
    draftText: string;
    id: EssayId;
    prompt: string;
    revision: number;
    wordLimit: number;
  };
  evidenceManifestVersion: ContentHmac;
  hasVoiceProfile: boolean;
  invalidEvidenceIds: string[];
  referenceDraft: {
    claims: Array<{
      decision: "CONFIRMED" | "REJECTED" | null;
      id: ProposalClaimId;
      text: string;
    }>;
    referenceText: string;
  } | null;
  schoolSourceIds: string[];
  storyFactIds: string[];
  unsupportedClaims: Array<{ evidenceIds: string[]; text: string }>;
};

export type CommitEssayAuditResult =
  | { type: "CREATED" | "REPLAY"; value: EssayAudit }
  | {
      type:
        | "IDEMPOTENCY_KEY_REUSED"
        | "MANIFEST_MISMATCH"
        | "NOT_FOUND"
        | "REVISION_MISMATCH";
    };

export interface EssayAuditRepository {
  commit(input: {
    auditId: EssayAuditId;
    essayId: EssayId;
    essayRevision: number;
    evidenceManifestVersion: ContentHmac;
    expectedDraftText: string;
    idempotencyKeyHmac: IdempotencyHmac;
    issues: AuditIssue[];
    now: Date;
    requestHmac: ContentHmac;
    similarity: SimilarityMetrics;
    status: "PASS" | "BLOCKED";
    userId: UserId;
  }): Promise<CommitEssayAuditResult>;
  loadContext(userId: UserId, essayId: EssayId): Promise<AuditContext | null>;
}
