import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database } from "@/adapters/supabase/database.types";
import {
  schoolRequestSchema,
  schoolSummarySchema,
  type SchoolRequest,
} from "@/contracts/http/v1/schools";
import type { ServerConfig } from "@/lib/config/server";
import type {
  CreateSchoolRequestDecision,
  SchoolRegistryRepository,
} from "@/repositories/school-registry-repository";

type RequestRow = Database["public"]["Tables"]["school_requests"]["Row"];

const mutationSchema = z.object({
  decision: z.enum(["CREATED", "REPLAY", "IDEMPOTENCY_KEY_REUSED"]),
  request: z.unknown().nullable(),
});

function timestamp(value: string): string {
  return new Date(value).toISOString();
}

function mapRequest(row: RequestRow): SchoolRequest {
  return schoolRequestSchema.parse({
    createdAt: timestamp(row.created_at),
    id: row.id,
    name: row.name,
    status: row.status,
    updatedAt: timestamp(row.updated_at),
    url: row.url,
    userId: row.user_id,
  });
}

export function createSupabaseSchoolRegistryRepository(
  config: ServerConfig,
): SchoolRegistryRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async search(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("search_schools", {
          requested_after_id: input.after?.id ?? null,
          requested_after_name: input.after?.normalizedName ?? null,
          requested_limit: input.limit,
          requested_query: input.query,
        });
      if (error) throw error;
      return (data ?? []).map((row) =>
        schoolSummarySchema.parse({
          canonicalName: row.canonical_name,
          id: row.id,
          officialDomain: row.official_domain,
        }),
      );
    },
    async createRequest(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("create_school_request", {
          requested_at: input.now.toISOString(),
          requested_idempotency_key_hmac: input.idempotencyKeyHmac,
          requested_name: input.name,
          requested_request_hmac: input.requestHmac,
          requested_url: input.url,
          requested_user_id: input.userId,
        });
      if (error) throw error;
      const result = mutationSchema.parse(data);
      if (result.decision === "IDEMPOTENCY_KEY_REUSED") {
        return { type: "IDEMPOTENCY_KEY_REUSED" };
      }
      if (!result.request) throw new Error("School request result is missing");
      return {
        type: result.decision,
        value: mapRequest(result.request as RequestRow),
      } satisfies CreateSchoolRequestDecision;
    },
  };
}
