import { describe, expect, it, vi } from "vitest";

import { createEssayPatchHandler } from "@/app/api/v1/essays/handler";
import type { EssayId } from "@/contracts/domain/ids";
import type { OutlineV1 } from "@/contracts/http/v1/outlines";
import { SaveOutlineError } from "@/services/essays/save-outline";

const appUrl = new URL("https://storybridge.test");
const essayId = "c1000000-0000-4000-8000-000000000001" as EssayId;
const factId = "c2000000-0000-4000-8000-000000000001";
const sourceId = "c3000000-0000-4000-8000-000000000001";
const outline: OutlineV1 = {
  schemaVersion: "1",
  sections: [1, 2, 3].map((position) => ({
    id: `c4000000-0000-4000-8000-00000000000${position}`,
    purpose: `Section ${position}`,
    schoolSourceIds: [sourceId],
    storyFactIds: [factId],
    targetWords: 100,
  })) as OutlineV1["sections"],
};
const essay = {
  createdAt: "2026-08-03T20:00:00.000Z",
  dossierId: "c5000000-0000-4000-8000-000000000001",
  id: essayId,
  outline,
  prompt: "Describe a community that shaped how you contribute today.",
  revision: 4,
  schoolId: "c6000000-0000-4000-8000-000000000001",
  season: "2026-2027" as const,
  selectedAngleId: "c7000000-0000-4000-8000-000000000001",
  status: "DRAFTING" as const,
  updatedAt: "2026-08-03T20:01:00.000Z",
  userId: "c0000000-0000-4000-8000-000000000001",
  wordLimit: 300,
};

function request(ifMatch?: string) {
  return new Request(new URL(`/api/v1/essays/${essayId}`, appUrl), {
    body: JSON.stringify({ outline }),
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

describe("ETag-safe outline patch", () => {
  it("requires If-Match before calling the update service", async () => {
    const update = vi.fn();
    const response = await createEssayPatchHandler({ appUrl, update })(
      request(),
      essayId,
    );
    expect(response.status).toBe(428);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns the new canonical essay and revision ETag after a valid save", async () => {
    const update = vi.fn().mockResolvedValue(essay);
    const response = await createEssayPatchHandler({ appUrl, update })(
      request(`"essay:${essayId}:r3"`),
      essayId,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"essay:${essayId}:r4"`);
    expect(update).toHaveBeenCalledWith(essayId, 3, outline);
    await expect(response.json()).resolves.toMatchObject({
      data: { outline, revision: 4, status: "DRAFTING" },
    });
  });

  it("maps a stale repository decision to precondition failed", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(new SaveOutlineError("REVISION_MISMATCH"));
    const response = await createEssayPatchHandler({ appUrl, update })(
      request(`"essay:${essayId}:r3"`),
      essayId,
    );
    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REVISION_MISMATCH" },
    });
  });
});
