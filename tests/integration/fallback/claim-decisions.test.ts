import { describe, expect, it, vi } from "vitest";

import type { EssayId, ProposalClaimId, UserId } from "@/contracts/domain/ids";
import { decideReferenceClaim } from "@/services/fallback/decide-claim";

const now = new Date("2026-08-04T13:00:00.000Z");
const userId = "f0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "f1000000-0000-4000-8000-000000000001" as EssayId;
const claimId = "f2000000-0000-4000-8000-000000000001" as ProposalClaimId;
const confirmation = {
  claimContentHmac: `v1.${"c".repeat(43)}`,
  claimId,
  decidedAt: now.toISOString(),
  decision: "CONFIRMED" as const,
  essayId,
  userId,
};

function dependencies(
  result:
    | { type: "DECIDED" | "REPLAY"; value: typeof confirmation }
    | {
        type: "IDEMPOTENCY_KEY_REUSED" | "NOT_FOUND" | "STATE_CONFLICT";
      } = { type: "DECIDED", value: confirmation },
) {
  return {
    claimConfirmations: { decide: vi.fn().mockResolvedValue(result) },
    hmacSecrets: {
      content: "content-secret-at-least-32-characters",
      idempotency: "idempotency-secret-at-least-32-characters",
      ip: "ip-secret-at-least-32-characters",
    },
    profiles: {
      getEligibility: vi.fn().mockResolvedValue({
        hasAcceptedInvitation: true,
        profile: {
          ageConfirmedAt: now.toISOString(),
          birthYear: 2000,
          consentedAt: now.toISOString(),
          privacyVersion: "privacy-2026-08-02",
          responsibleUseVersion: "responsible-use-2026-08-02",
          termsVersion: "terms-2026-08-02",
        },
      }),
    },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

describe("reference claim decisions", () => {
  it("binds an owned decision to opaque idempotency and request HMACs", async () => {
    const deps = dependencies();
    await expect(
      decideReferenceClaim(
        essayId,
        claimId,
        { decision: "CONFIRM" },
        { idempotencyKey: "claim-key-00000001" },
        deps as never,
        now,
      ),
    ).resolves.toEqual(confirmation);
    expect(deps.claimConfirmations.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId,
        decision: "CONFIRM",
        essayId,
        idempotencyKeyHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
        requestHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
        userId,
      }),
    );
  });

  it("replays an identical immutable decision", async () => {
    const deps = dependencies({ type: "REPLAY", value: confirmation });
    await expect(
      decideReferenceClaim(
        essayId,
        claimId,
        { decision: "CONFIRM" },
        { idempotencyKey: "claim-key-00000001" },
        deps as never,
        now,
      ),
    ).resolves.toEqual(confirmation);
  });

  it.each([
    ["IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
    ["NOT_FOUND", "RESOURCE_NOT_FOUND"],
    ["STATE_CONFLICT", "STATE_CONFLICT"],
  ] as const)("maps %s without exposing ownership", async (type, code) => {
    const deps = dependencies({ type });
    await expect(
      decideReferenceClaim(
        essayId,
        claimId,
        { decision: "REJECT" },
        { idempotencyKey: "claim-key-00000002" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code });
  });
});
