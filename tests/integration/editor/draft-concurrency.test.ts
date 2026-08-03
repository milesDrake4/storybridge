import { describe, expect, it, vi } from "vitest";

import { createEssayPatchHandler } from "@/app/api/v1/essays/handler";
import type { EssayId, SchoolId, UserId } from "@/contracts/domain/ids";
import type { Essay } from "@/contracts/http/v1/essays";
import { outlineV1Schema } from "@/contracts/http/v1/outlines";
import type { EssayVersionRepository } from "@/repositories/essay-version-repository";
import {
  normalizeDraftText,
  SaveDraftError,
  saveEssayDraft,
} from "@/services/essays/save-draft";

const now = new Date("2026-08-03T22:00:00.000Z");
const appUrl = new URL("https://storybridge.test");
const userId = "e0000000-0000-4000-8000-000000000001" as UserId;
const essayId = "e1000000-0000-4000-8000-000000000001" as EssayId;
const essay: Essay = {
  createdAt: now.toISOString(),
  dossierId: "e2000000-0000-4000-8000-000000000001",
  draftText: "A newer canonical draft.",
  id: essayId,
  outline: outlineV1Schema.parse({
    schemaVersion: "1",
    sections: [1, 2, 3].map((position) => ({
      id: `e3000000-0000-4000-8000-00000000000${position}`,
      purpose: `Purpose ${position}`,
      schoolSourceIds: ["e4000000-0000-4000-8000-000000000001"],
      storyFactIds: ["e5000000-0000-4000-8000-000000000001"],
      targetWords: 100,
    })),
  }),
  prompt: "Describe a community that shaped how you contribute today.",
  revision: 4,
  schoolId: "e6000000-0000-4000-8000-000000000001" as SchoolId,
  season: "2026-2027",
  selectedAngleId:
    "e7000000-0000-4000-8000-000000000001" as Essay["selectedAngleId"],
  status: "DRAFTING",
  updatedAt: now.toISOString(),
  userId,
  wordLimit: 300,
};

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

function versions(
  result: Awaited<ReturnType<EssayVersionRepository["save"]>> = {
    type: "UPDATED",
    value: essay,
  },
): EssayVersionRepository {
  return { save: vi.fn().mockResolvedValue(result) };
}

function request(body: unknown, ifMatch?: string) {
  return new Request(new URL(`/api/v1/essays/${essayId}`, appUrl), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: appUrl.host,
      origin: appUrl.origin,
      "sec-fetch-site": "same-origin",
      ...(ifMatch ? { "if-match": ifMatch } : {}),
    },
    method: "PATCH",
  });
}

describe("conflict-safe draft persistence", () => {
  it("normalizes line endings and delegates one owner-scoped autosave", async () => {
    const repository = versions();
    await expect(
      saveEssayDraft(
        essayId,
        3,
        { draftText: "First line\r\nSecond line\r" },
        { ...eligibility(), versions: repository },
        now,
      ),
    ).resolves.toEqual(essay);
    expect(repository.save).toHaveBeenCalledWith({
      acceptedProposalId: null,
      draftText: "First line\nSecond line\n",
      essayId,
      expectedRevision: 3,
      now,
      origin: "AUTOSAVE",
      userId,
    });
    expect(normalizeDraftText("Cafe\u0301\r\n")).toBe("Café\n");
  });

  it("passes an outline and draft through one atomic repository mutation", async () => {
    const repository = versions();
    await saveEssayDraft(
      essayId,
      3,
      { draftText: "Student text", outline: essay.outline! },
      { ...eligibility(), versions: repository },
      now,
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        draftText: "Student text",
        outline: essay.outline,
      }),
    );
  });

  it("surfaces a stale write once and never retries over newer text", async () => {
    const repository = versions({ type: "REVISION_MISMATCH" });
    await expect(
      saveEssayDraft(
        essayId,
        3,
        { draftText: "Older local text" },
        { ...eligibility(), versions: repository },
        now,
      ),
    ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it("masks cross-owner saves as missing", async () => {
    await expect(
      saveEssayDraft(
        essayId,
        3,
        { draftText: "Attempted text" },
        { ...eligibility(), versions: versions({ type: "NOT_FOUND" }) },
        now,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("enforces preconditions and rejects control characters at the route boundary", async () => {
    const update = vi.fn();
    const handler = createEssayPatchHandler({ appUrl, update });
    expect(
      (await handler(request({ draftText: "Text" }), essayId)).status,
    ).toBe(428);
    expect(
      (
        await handler(
          request({ draftText: "Unsafe\u0001text" }, `"essay:${essayId}:r3"`),
          essayId,
        )
      ).status,
    ).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 412 without a success body for a concurrent stale save", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(new SaveDraftError("REVISION_MISMATCH"));
    const response = await createEssayPatchHandler({ appUrl, update })(
      request({ draftText: "Older local text" }, `"essay:${essayId}:r3"`),
      essayId,
    );
    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REVISION_MISMATCH" },
    });
  });
});
