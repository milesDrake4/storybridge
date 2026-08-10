import { describe, expect, it, vi } from "vitest";

import { createBillingEntitlementGetHandler } from "@/app/api/v1/billing/entitlement/handler";
import {
  billingEntitlementSchema,
  type BillingEntitlement,
} from "@/contracts/http/v1/billing";
import type { UserId } from "@/contracts/domain/ids";
import type { EntitlementRepository } from "@/repositories/entitlement-repository";
import { EligibilityError } from "@/services/auth/eligibility";
import { getBillingEntitlement } from "@/services/essays/essay-allowance";

const now = new Date("2026-08-10T16:00:00.000Z");
const userId = "fd000000-0000-4000-8000-000000000001" as UserId;
const paidEntitlement = {
  essayLimit: 20,
  essaysRemaining: 17,
  essaysUsed: 3,
  kind: "SEASON_PASS",
  season: "2026-2027",
  seasonPassStatus: "ACTIVE",
  status: "ACTIVE",
} as const satisfies BillingEntitlement;

function eligibility() {
  return {
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          createdAt: now.toISOString(),
          displayName: null,
          onboardingState: "NOT_STARTED" as const,
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
          updatedAt: now.toISOString(),
          userId,
        },
      }),
      recordConsent: vi.fn(),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

function repository(
  value: BillingEntitlement = paidEntitlement,
): EntitlementRepository {
  return { getCurrent: vi.fn().mockResolvedValue(value) };
}

describe("billing entitlement contract", () => {
  it("exposes bounded effective usage and the paid lifecycle state", () => {
    expect(billingEntitlementSchema.parse(paidEntitlement)).toEqual(
      paidEntitlement,
    );
    expect(() =>
      billingEntitlementSchema.parse({
        ...paidEntitlement,
        essaysRemaining: 18,
      }),
    ).toThrow();
  });

  it("can show a terminal season pass while the free allowance remains effective", () => {
    expect(
      billingEntitlementSchema.parse({
        essayLimit: 1,
        essaysRemaining: 1,
        essaysUsed: 0,
        kind: "FREE",
        season: "2026-2027",
        seasonPassStatus: "REFUNDED",
        status: "ACTIVE",
      }),
    ).toMatchObject({ kind: "FREE", seasonPassStatus: "REFUNDED" });
  });
});

describe("paid allowance service", () => {
  it("reads the server-owned current-season entitlement for the eligible user", async () => {
    const entitlements = repository();

    await expect(
      getBillingEntitlement({ ...eligibility(), entitlements }, now),
    ).resolves.toEqual(paidEntitlement);
    expect(entitlements.getCurrent).toHaveBeenCalledWith({
      at: now,
      season: "2026-2027",
      userId,
    });
  });
});

describe("billing entitlement route boundary", () => {
  it("returns the typed entitlement in the standard no-store envelope", async () => {
    const response = await createBillingEntitlementGetHandler({
      get: vi.fn().mockResolvedValue(paidEntitlement),
    })(new Request("https://storybridge.test/api/v1/billing/entitlement"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "1",
      data: paidEntitlement,
    });
  });

  it("preserves stable eligibility errors", async () => {
    const response = await createBillingEntitlementGetHandler({
      get: vi.fn().mockRejectedValue(new EligibilityError("CONSENT_REQUIRED")),
    })(new Request("https://storybridge.test/api/v1/billing/entitlement"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CONSENT_REQUIRED" },
    });
  });
});
