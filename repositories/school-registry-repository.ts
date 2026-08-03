import type { SchoolId, UserId } from "@/contracts/domain/ids";
import type { SchoolRequest, SchoolSummary } from "@/contracts/http/v1/schools";
import type { ContentHmac, IdempotencyHmac } from "@/lib/security/hmac";

export type SchoolSearchPosition = {
  id: SchoolId;
  normalizedName: string;
};

export type CreateSchoolRequestDecision =
  | { type: "CREATED" | "REPLAY"; value: SchoolRequest }
  | { type: "IDEMPOTENCY_KEY_REUSED" };

export interface SchoolRegistryRepository {
  search(input: {
    after: SchoolSearchPosition | null;
    limit: number;
    query: string;
  }): Promise<SchoolSummary[]>;
  createRequest(input: {
    idempotencyKeyHmac: IdempotencyHmac;
    name: string;
    now: Date;
    requestHmac: ContentHmac;
    url: string | null;
    userId: UserId;
  }): Promise<CreateSchoolRequestDecision>;
}
