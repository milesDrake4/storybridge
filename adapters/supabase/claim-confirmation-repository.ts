import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import {
  claimConfirmationSchema,
  type ClaimConfirmation,
} from "@/contracts/http/v1/reference-drafts";
import type { ServerConfig } from "@/lib/config/server";
import type {
  ClaimConfirmationRepository,
  ClaimDecisionResult,
} from "@/repositories/claim-confirmation-repository";

const rowSchema = z.object({
  claim_content_hmac: z.string(),
  claim_id: z.string(),
  decided_at: z.string(),
  decision: z.enum(["CONFIRMED", "REJECTED"]),
  essay_id: z.string(),
  user_id: z.string(),
});
const resultSchema = z.object({
  confirmation: z.unknown().nullable(),
  decision: z.enum([
    "DECIDED",
    "IDEMPOTENCY_KEY_REUSED",
    "NOT_FOUND",
    "REPLAY",
    "STATE_CONFLICT",
  ]),
});

function mapConfirmation(value: unknown): ClaimConfirmation {
  const row = rowSchema.parse(value);
  return claimConfirmationSchema.parse({
    claimContentHmac: row.claim_content_hmac,
    claimId: row.claim_id,
    decidedAt: new Date(row.decided_at).toISOString(),
    decision: row.decision,
    essayId: row.essay_id,
    userId: row.user_id,
  });
}

export function createSupabaseClaimConfirmationRepository(
  config: ServerConfig,
): ClaimConfirmationRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async decide(input): Promise<ClaimDecisionResult> {
      const { data, error } = await client
        .schema("private")
        .rpc("decide_reference_claim", {
          requested_at: input.now.toISOString(),
          requested_claim_id: input.claimId,
          requested_decision: input.decision,
          requested_essay_id: input.essayId,
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_request_hmac: input.requestHmac,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = resultSchema.parse(data);
      if (result.decision !== "DECIDED" && result.decision !== "REPLAY") {
        return { type: result.decision };
      }
      if (!result.confirmation) throw new Error("Claim decision is missing");
      return {
        type: result.decision,
        value: mapConfirmation(result.confirmation),
      };
    },
  };
}
