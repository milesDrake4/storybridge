import type { UserId } from "@/contracts/domain/ids";
import type { ConsentInput, Profile } from "@/contracts/http/v1/me";
import type { ErrorCode } from "@/contracts/http/v1/errors";

export const CURRENT_POLICY_VERSIONS = {
  privacyVersion: "privacy-2026-08-02",
  responsibleUseVersion: "responsible-use-2026-08-02",
  termsVersion: "terms-2026-08-02",
} as const;

type EligibilityErrorCode = Extract<
  ErrorCode,
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "INVITATION_REQUIRED"
  | "CONSENT_REQUIRED"
  | "BETA_AGE_RESTRICTED"
>;

export class EligibilityError extends Error {
  readonly code: EligibilityErrorCode;

  constructor(code: EligibilityErrorCode) {
    super(code);
    this.name = "EligibilityError";
    this.code = code;
  }
}

export type AuthenticatedSession = {
  requireUserId(): Promise<UserId>;
};

export type EligibilityState = {
  hasAcceptedInvitation: boolean;
  profile: Profile | null;
};

export type ProfileEligibilityRepository = {
  getEligibility(userId: UserId): Promise<EligibilityState>;
  recordConsent(
    userId: UserId,
    input: ConsentInput,
    now: Date,
  ): Promise<Profile>;
};

export type EligibilityDependencies = {
  profiles: ProfileEligibilityRepository;
  session: AuthenticatedSession;
};

function isAdult(birthYear: number, now: Date): boolean {
  return birthYear <= now.getUTCFullYear() - 18;
}

function hasCurrentPolicies(profile: {
  privacyVersion: string;
  responsibleUseVersion: string;
  termsVersion: string;
}): boolean {
  return (
    profile.privacyVersion === CURRENT_POLICY_VERSIONS.privacyVersion &&
    profile.responsibleUseVersion ===
      CURRENT_POLICY_VERSIONS.responsibleUseVersion &&
    profile.termsVersion === CURRENT_POLICY_VERSIONS.termsVersion
  );
}

export async function recordConsent(
  input: ConsentInput,
  dependencies: EligibilityDependencies,
  now = new Date(),
): Promise<Profile> {
  const userId = await dependencies.session.requireUserId();
  const state = await dependencies.profiles.getEligibility(userId);
  if (!state.hasAcceptedInvitation) {
    throw new EligibilityError("INVITATION_REQUIRED");
  }
  if (!hasCurrentPolicies(input)) {
    throw new EligibilityError("CONSENT_REQUIRED");
  }
  if (!isAdult(input.birthYear, now)) {
    throw new EligibilityError("BETA_AGE_RESTRICTED");
  }
  return dependencies.profiles.recordConsent(userId, input, now);
}

export async function requireProductEligibility(
  dependencies: EligibilityDependencies,
  now = new Date(),
): Promise<{ profile: Profile; userId: UserId }> {
  const userId = await dependencies.session.requireUserId();
  const state = await dependencies.profiles.getEligibility(userId);
  if (!state.hasAcceptedInvitation) {
    throw new EligibilityError("INVITATION_REQUIRED");
  }
  if (!state.profile) {
    throw new EligibilityError("CONSENT_REQUIRED");
  }
  if (!isAdult(state.profile.birthYear, now)) {
    throw new EligibilityError("BETA_AGE_RESTRICTED");
  }
  if (!hasCurrentPolicies(state.profile)) {
    throw new EligibilityError("CONSENT_REQUIRED");
  }
  return { profile: state.profile, userId };
}

export async function requirePrivacyAccess(
  session: AuthenticatedSession,
): Promise<UserId> {
  return session.requireUserId();
}
