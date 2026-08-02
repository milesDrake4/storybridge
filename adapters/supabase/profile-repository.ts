import { profileSchema, type Profile } from "@/contracts/http/v1/me";
import type { ServerConfig } from "@/lib/config/server";
import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database } from "@/adapters/supabase/database.types";
import type { ProfileRepository } from "@/repositories/profile-repository";
import { EligibilityError } from "@/services/auth/eligibility";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
const databaseTimestampSchema = z.iso.datetime({ offset: true });

function canonicalTimestamp(value: string): string {
  return new Date(databaseTimestampSchema.parse(value)).toISOString();
}

export function mapProfileRow(row: ProfileRow): Profile {
  return profileSchema.parse({
    ageConfirmedAt: canonicalTimestamp(row.age_confirmed_at),
    birthYear: row.birth_year,
    consentedAt: canonicalTimestamp(row.consented_at),
    createdAt: canonicalTimestamp(row.created_at),
    displayName: row.display_name,
    onboardingState: row.onboarding_state,
    privacyVersion: row.privacy_version,
    responsibleUseVersion: row.responsible_use_version,
    termsVersion: row.terms_version,
    updatedAt: canonicalTimestamp(row.updated_at),
    userId: row.user_id,
  });
}

export function createSupabaseProfileRepository(
  config: ServerConfig,
): ProfileRepository {
  const client = createSupabaseSecretClient(config);
  return {
    async getEligibility(userId) {
      const [invitation, profile] = await Promise.all([
        client
          .schema("private")
          .from("beta_invitations")
          .select("id")
          .eq("accepted_user_id", userId)
          .eq("status", "ACCEPTED")
          .maybeSingle(),
        client.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (invitation.error) throw invitation.error;
      if (profile.error) throw profile.error;
      return {
        hasAcceptedInvitation: invitation.data !== null,
        profile: profile.data ? mapProfileRow(profile.data) : null,
      };
    },
    async recordConsent(userId, input, now) {
      const { data, error } = await client
        .schema("private")
        .rpc("record_profile_consent", {
          requested_at: now.toISOString(),
          requested_birth_year: input.birthYear,
          requested_privacy_version: input.privacyVersion,
          requested_responsible_use_version: input.responsibleUseVersion,
          requested_terms_version: input.termsVersion,
          requested_user_id: userId,
        });
      if (error) throw error;
      if (!data?.[0]) throw new EligibilityError("INVITATION_REQUIRED");
      return mapProfileRow(data[0]);
    },
  };
}
