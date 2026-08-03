import type { EssayId, SchoolId, UserId } from "@/contracts/domain/ids";
import type {
  ApplicationSeason,
  EssayWorkspace,
} from "@/contracts/http/v1/essays";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export type EssayListPosition = {
  id: EssayId;
  updatedAt: string;
};

export type CreateEssayWorkspaceDecision =
  | { type: "CREATED" | "REPLAY"; value: EssayWorkspace }
  | {
      type:
        | "IDEMPOTENCY_KEY_REUSED"
        | "NOT_ELIGIBLE"
        | "QUOTA_EXCEEDED"
        | "REPLAY_DELETED"
        | "UNSUPPORTED_SCHOOL";
    };

export interface EssayWorkspaceRepository {
  create(input: {
    idempotencyKeyHmac: IdempotencyHmac;
    now: Date;
    prompt: string;
    requestHmac: ContentHmac;
    schoolId: SchoolId;
    season: ApplicationSeason;
    userId: UserId;
    wordLimit: number;
  }): Promise<CreateEssayWorkspaceDecision>;
  delete(userId: UserId, essayId: EssayId): Promise<boolean>;
  get(userId: UserId, essayId: EssayId): Promise<EssayWorkspace | null>;
  list(input: {
    after: EssayListPosition | null;
    limit: number;
    userId: UserId;
  }): Promise<EssayWorkspace[]>;
  updateOutline(input: {
    essayId: EssayId;
    expectedRevision: number;
    now: Date;
    outline: OutlineV1;
    userId: UserId;
  }): Promise<
    | { type: "NOT_FOUND" | "REVISION_MISMATCH" | "STATE_CONFLICT" }
    | { type: "UPDATED"; value: EssayWorkspace["essay"] }
  >;
}
