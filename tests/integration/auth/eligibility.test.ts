import { describe, expect, it, vi } from "vitest";

import type { UserId } from "@/contracts/domain/ids";
import type { Profile } from "@/contracts/http/v1/me";
import {
  CURRENT_POLICY_VERSIONS,
  EligibilityError,
  recordConsent,
  requirePrivacyAccess,
  requireProductEligibility,
} from "@/services/auth/eligibility";

const userId = "10000000-0000-0000-0000-000000000001" as UserId;
const now = new Date("2026-08-02T12:00:00Z");
const currentConsent = {
  ageConfirmed: true as const,
  birthYear: 2000,
  ...CURRENT_POLICY_VERSIONS,
};
const currentProfile: Profile = {
  ageConfirmedAt: now.toISOString(),
  birthYear: 2000,
  consentedAt: now.toISOString(),
  createdAt: now.toISOString(),
  displayName: null,
  onboardingState: "NOT_STARTED" as const,
  ...CURRENT_POLICY_VERSIONS,
  updatedAt: now.toISOString(),
  userId,
};

function dependencies(
  overrides: {
    invited?: boolean;
    profile?: typeof currentProfile | null;
  } = {},
) {
  return {
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: overrides.invited ?? true,
        profile:
          overrides.profile === undefined ? currentProfile : overrides.profile,
      }),
      recordConsent: vi.fn().mockResolvedValue(currentProfile),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

describe("recordConsent", () => {
  it("lets an authenticated invited adult bootstrap current consent", async () => {
    const deps = dependencies({ profile: null });

    const profile = await recordConsent(currentConsent, deps, now);

    expect(profile).toEqual(currentProfile);
    expect(deps.profiles.recordConsent).toHaveBeenCalledWith(
      userId,
      currentConsent,
      now,
    );
  });

  it("rejects under-18 consent before writing a profile", async () => {
    const deps = dependencies({ profile: null });

    await expect(
      recordConsent({ ...currentConsent, birthYear: 2010 }, deps, now),
    ).rejects.toMatchObject({ code: "BETA_AGE_RESTRICTED" });
    expect(deps.profiles.recordConsent).not.toHaveBeenCalled();
  });

  it("rejects uninvited and stale-policy bootstrap attempts", async () => {
    await expect(
      recordConsent(currentConsent, dependencies({ invited: false }), now),
    ).rejects.toMatchObject({ code: "INVITATION_REQUIRED" });
    await expect(
      recordConsent(
        { ...currentConsent, termsVersion: "terms-old" },
        dependencies(),
        now,
      ),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });
});

describe("requireProductEligibility", () => {
  it("returns the authenticated identity only for an invited adult with current consent", async () => {
    await expect(
      requireProductEligibility(dependencies(), now),
    ).resolves.toEqual({ profile: currentProfile, userId });
  });

  it.each([
    [
      "revoked or uninvited",
      dependencies({ invited: false }),
      "INVITATION_REQUIRED",
    ],
    [
      "stale consent",
      dependencies({
        profile: { ...currentProfile, privacyVersion: "privacy-old" },
      }),
      "CONSENT_REQUIRED",
    ],
    [
      "under-18 profile",
      dependencies({ profile: { ...currentProfile, birthYear: 2010 } }),
      "BETA_AGE_RESTRICTED",
    ],
  ])("rejects %s", async (_label, deps, code) => {
    await expect(requireProductEligibility(deps, now)).rejects.toMatchObject({
      code,
    });
  });
});

describe("requirePrivacyAccess", () => {
  it("remains available to an authenticated user without consulting eligibility", async () => {
    const deps = dependencies({ invited: false, profile: null });

    await expect(requirePrivacyAccess(deps.session)).resolves.toBe(userId);
    expect(deps.profiles.getEligibility).not.toHaveBeenCalled();
  });

  it("preserves a stable typed authentication failure", async () => {
    const session = {
      requireUserId: vi
        .fn()
        .mockRejectedValue(new EligibilityError("AUTH_REQUIRED")),
    };

    await expect(requirePrivacyAccess(session)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});
