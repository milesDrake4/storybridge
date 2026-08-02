import type { UserId } from "@/contracts/domain/ids";
import type { ConsentInput, Profile } from "@/contracts/http/v1/me";

export type EligibilityState = {
  hasAcceptedInvitation: boolean;
  profile: Profile | null;
};

export type ProfileRepository = {
  getEligibility(userId: UserId): Promise<EligibilityState>;
  recordConsent(
    userId: UserId,
    input: ConsentInput,
    now: Date,
  ): Promise<Profile>;
};
