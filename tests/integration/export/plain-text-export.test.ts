import { describe, expect, it, vi } from "vitest";

import { createDraftExportGetHandler } from "@/app/api/v1/essays/export-handler";
import type { EssayId, UserId } from "@/contracts/domain/ids";
import type { DraftExportRepository } from "@/repositories/draft-export-repository";
import {
  exportStudentDraft,
  ExportStudentDraftError,
} from "@/services/export/export-draft";

const essayId = "ed100000-0000-4000-8000-000000000001" as EssayId;
const userId = "ed000000-0000-4000-8000-000000000001" as UserId;

function dependencies(
  result: Awaited<ReturnType<DraftExportRepository["get"]>>,
) {
  return {
    exports: { get: vi.fn().mockResolvedValue(result) },
    session: { requireUserId: vi.fn().mockResolvedValue(userId) },
  };
}

describe("student-draft-only export", () => {
  it("returns only normalized student draft text after a current PASS audit", async () => {
    const deps = dependencies({
      draftText: "My student‑authored draft.\r\nSecond line.",
      type: "EXPORTABLE",
    });

    await expect(exportStudentDraft(essayId, deps)).resolves.toBe(
      "My student‐authored draft.\nSecond line.",
    );
    expect(deps.exports.get).toHaveBeenCalledWith(userId, essayId);
  });

  it.each(["BLOCKED", "NOT_FOUND"] as const)(
    "maps the %s repository decision to a declared error",
    async (type) => {
      const code = type === "BLOCKED" ? "EXPORT_BLOCKED" : "RESOURCE_NOT_FOUND";
      await expect(
        exportStudentDraft(essayId, dependencies({ type })),
      ).rejects.toMatchObject({ code });
    },
  );

  it("serves an attachment without metadata, reference content, or caching", async () => {
    const studentDraft = "My choices and reflection belong to me.";
    const handler = createDraftExportGetHandler({
      exportDraft: vi.fn().mockResolvedValue(studentDraft),
    });
    const response = await handler(essayId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="storybridge-essay.txt"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(body).toBe(studentDraft);
    expect(body).not.toContain("reference draft");
  });

  it("returns declared JSON errors for blocked, stale, and unowned exports", async () => {
    const handler = createDraftExportGetHandler({
      exportDraft: vi
        .fn()
        .mockRejectedValueOnce(new ExportStudentDraftError("EXPORT_BLOCKED"))
        .mockRejectedValueOnce(
          new ExportStudentDraftError("RESOURCE_NOT_FOUND"),
        ),
    });

    const blocked = await handler(essayId);
    expect(blocked.status).toBe(409);
    expect(blocked.headers.get("content-type")).toContain("application/json");
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "EXPORT_BLOCKED" },
    });

    const unowned = await handler(essayId);
    expect(unowned.status).toBe(404);
    await expect(unowned.json()).resolves.toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND" },
    });
  });
});
