import { describe, expect, it, vi } from "vitest";

import { createAngleSelectionPostHandler } from "@/app/api/v1/essays/angle-selection-handler";
import type {
  EssayAngleId,
  EssayId,
  SchoolId,
  UserId,
} from "@/contracts/domain/ids";
import type { Essay } from "@/contracts/http/v1/essays";
import type { EssayAngleRepository } from "@/repositories/essay-angle-repository";
import type { EssayWorkspaceRepository } from "@/repositories/essay-workspace-repository";
import { selectEssayAngle } from "@/services/strategy/select-angle";

const appUrl = new URL("https://storybridge.test");
const now = new Date("2026-08-03T21:00:00.000Z");
const userId = "c0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "c1000000-0000-4000-8000-000000000001" as EssayId;
const angleId = "c2000000-0000-4000-8000-000000000001" as EssayAngleId;
const essay = {
  createdAt: now.toISOString(),
  dossierId: "c3000000-0000-4000-8000-000000000001",
  id: essayId,
  outline: null,
  prompt: "How will your experiences help you contribute to our community?",
  revision: 2,
  schoolId: "c4000000-0000-4000-8000-000000000001" as SchoolId,
  season: "2026-2027",
  selectedAngleId: angleId,
  status: "OUTLINING",
  updatedAt: now.toISOString(),
  userId,
  wordLimit: 300,
} as Essay;

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
          onboardingState: "COMPLETE" as const,
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

describe("atomic angle selection", () => {
  it("selects only through the owner-scoped repository and returns reloadable state", async () => {
    const angles = {
      commit: vi.fn(),
      list: vi.fn(),
      select: vi.fn().mockResolvedValue({ type: "SELECTED" }),
      update: vi.fn(),
    } satisfies EssayAngleRepository;
    const essays = {
      create: vi.fn(),
      delete: vi.fn(),
      get: vi.fn().mockResolvedValue({
        essay,
        school: {
          canonicalName: "University of Michigan",
          id: essay.schoolId,
          officialDomain: "umich.edu",
        },
      }),
      list: vi.fn(),
      updateOutline: vi.fn(),
    } as EssayWorkspaceRepository;

    await expect(
      selectEssayAngle(
        essayId,
        angleId,
        { ...eligibility(), angles, essays },
        now,
      ),
    ).resolves.toEqual(essay);
    expect(angles.select).toHaveBeenCalledWith({
      angleId,
      essayId,
      now,
      userId,
    });
    expect(essays.get).toHaveBeenCalledWith(userId, essayId);
  });

  it("masks an angle outside the owned essay as not found", async () => {
    const angles = {
      commit: vi.fn(),
      list: vi.fn(),
      select: vi.fn().mockResolvedValue({ type: "NOT_FOUND" }),
      update: vi.fn(),
    } satisfies EssayAngleRepository;
    const essays = {
      create: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      updateOutline: vi.fn(),
    } as EssayWorkspaceRepository;

    await expect(
      selectEssayAngle(
        essayId,
        angleId,
        { ...eligibility(), angles, essays },
        now,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(essays.get).not.toHaveBeenCalled();
  });

  it("requires idempotency and returns the advanced essay ETag", async () => {
    const select = vi.fn().mockResolvedValue(essay);
    const handler = createAngleSelectionPostHandler({ appUrl, select });
    const headers = {
      "content-type": "application/json",
      host: appUrl.host,
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
    };
    const missing = await handler(
      new Request(`${appUrl}selection`, {
        body: "{}",
        headers,
        method: "POST",
      }),
      essayId,
      angleId,
    );
    expect(missing.status).toBe(428);

    const response = await handler(
      new Request(`${appUrl}selection`, {
        body: "{}",
        headers: { ...headers, "idempotency-key": "select-angle-key-0001" },
        method: "POST",
      }),
      essayId,
      angleId,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"essay:${essayId}:r2"`);
  });
});
