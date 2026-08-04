import { describe, expect, it, vi } from "vitest";

import { createAuditPostHandler } from "@/app/api/v1/essays/audit-handler";
import type { EssayAuditId, EssayId, UserId } from "@/contracts/domain/ids";
import {
  measureReferenceSimilarity,
  noReferenceSimilarity,
} from "@/domain/audit/similarity";
import type { AuditContext } from "@/repositories/essay-audit-repository";
import { auditEssay, AuditEssayError } from "@/services/audit/audit-essay";

const now = new Date("2026-08-05T12:00:00.000Z");
const userId = "ac000000-0000-4000-8000-000000000001" as UserId;
const essayId = "ac100000-0000-4000-8000-000000000001" as EssayId;
const auditId = "ac200000-0000-4000-8000-000000000001" as EssayAuditId;
const factId = "ac300000-0000-4000-8000-000000000001";
const sourceId = "ac400000-0000-4000-8000-000000000001";
const claimId = "ac500000-0000-4000-8000-000000000001";

const context: AuditContext = {
  essay: {
    draftText:
      "Community bicycle repair taught me to listen, collaborate, and contribute with care.",
    id: essayId,
    prompt: "Describe how you will contribute to this campus community.",
    revision: 9,
    wordLimit: 300,
  },
  evidenceManifestVersion: `v1.${"e".repeat(43)}` as never,
  hasVoiceProfile: true,
  invalidEvidenceIds: [],
  referenceDraft: null,
  schoolSourceIds: [sourceId],
  storyFactIds: [factId],
  unsupportedClaims: [],
};

function dependencies(
  currentContext: AuditContext | null = context,
  resultType: "CREATED" | "REPLAY" = "CREATED",
) {
  const audits = {
    commit: vi.fn().mockImplementation(async (input) => ({
      type: resultType,
      value: {
        createdAt: now.toISOString(),
        essayId,
        essayRevision: input.essayRevision,
        evidenceManifestVersion: input.evidenceManifestVersion,
        id: auditId,
        issues: input.issues,
        similarity: input.similarity,
        status: input.status,
        userId,
      },
    })),
    loadContext: vi.fn().mockResolvedValue(currentContext),
  };
  return {
    audits,
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
    similarity: {
      measure: measureReferenceSimilarity,
      noReference: noReferenceSimilarity,
    },
  };
}

describe("current-revision essay audits", () => {
  it("persists a passing audit bound to revision, manifest, and idempotency", async () => {
    const deps = dependencies();
    await expect(
      auditEssay(
        essayId,
        { idempotencyKey: "audit-key-00000001" },
        deps as never,
        now,
      ),
    ).resolves.toMatchObject({ issues: [], status: "PASS" });
    expect(deps.audits.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        essayRevision: 9,
        evidenceManifestVersion: context.evidenceManifestVersion,
        expectedDraftText: context.essay.draftText,
        idempotencyKeyHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
        requestHmac: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
        status: "PASS",
        userId,
      }),
    );
  });

  it("blocks word-limit, unsupported, rejected, undecided, invalid-evidence, and similarity failures", async () => {
    const referenceText = Array.from(
      { length: 45 },
      (_, index) => `reference${index}`,
    ).join(" ");
    const rejectedText = "rejected factual statement";
    const blockedContext: AuditContext = {
      ...context,
      essay: {
        ...context.essay,
        draftText: `${referenceText} ${rejectedText} unsupported factual statement`,
        wordLimit: 10,
      },
      invalidEvidenceIds: [factId],
      referenceDraft: {
        claims: [
          { decision: "REJECTED", id: claimId as never, text: rejectedText },
          {
            decision: null,
            id: "ac500000-0000-4000-8000-000000000002" as never,
            text: "another factual statement",
          },
        ],
        referenceText,
      },
      unsupportedClaims: [
        { evidenceIds: [], text: "unsupported factual statement" },
      ],
    };
    const deps = dependencies(blockedContext);
    const result = await auditEssay(
      essayId,
      { idempotencyKey: "audit-key-00000002" },
      deps as never,
      now,
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "WORD_LIMIT_EXCEEDED",
        "EVIDENCE_MISSING",
        "UNSUPPORTED_CLAIM",
        "REJECTED_CLAIM_PRESENT",
        "REFERENCE_CLAIM_UNDECIDED",
        "REFERENCE_SIMILARITY",
      ]),
    );
  });

  it("does not block a rejected claim after its exact normalized phrase is absent", async () => {
    const deps = dependencies({
      ...context,
      referenceDraft: {
        claims: [
          {
            decision: "REJECTED",
            id: claimId as never,
            text: "The rejected claim is no longer present.",
          },
        ],
        referenceText: "A short and clearly different reference.",
      },
    });
    await expect(
      auditEssay(
        essayId,
        { idempotencyKey: "audit-key-00000003" },
        deps as never,
        now,
      ),
    ).resolves.not.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "REJECTED_CLAIM_PRESENT" }),
      ]),
    });
  });

  it("blocks a non-empty draft when its outline has no current evidence", async () => {
    const deps = dependencies({
      ...context,
      schoolSourceIds: [],
      storyFactIds: [],
    });
    await expect(
      auditEssay(
        essayId,
        { idempotencyKey: "audit-key-00000008" },
        deps as never,
        now,
      ),
    ).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "EVIDENCE_MISSING",
          severity: "BLOCKING",
        }),
      ]),
      status: "BLOCKED",
    });
  });

  it("fails closed and persists nothing when similarity calculation fails", async () => {
    const deps = dependencies({
      ...context,
      referenceDraft: { claims: [], referenceText: "reference" },
    });
    deps.similarity.measure = vi.fn(() => {
      throw new Error("calculation failed");
    });
    await expect(
      auditEssay(
        essayId,
        { idempotencyKey: "audit-key-00000004" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(deps.audits.commit).not.toHaveBeenCalled();
  });

  it("does not disclose a missing or unowned essay", async () => {
    const deps = dependencies(null);
    await expect(
      auditEssay(
        essayId,
        { idempotencyKey: "audit-key-00000005" },
        deps as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("serves the declared POST contract without accepting caller state", async () => {
    const audit = vi.fn().mockResolvedValue({
      createdAt: now.toISOString(),
      essayId,
      essayRevision: 9,
      evidenceManifestVersion: context.evidenceManifestVersion,
      id: auditId,
      issues: [],
      similarity: noReferenceSimilarity(context.essay.draftText),
      status: "PASS",
      userId,
    });
    const handler = createAuditPostHandler({
      appUrl: new URL("https://storybridge.test"),
      audit,
    });
    const response = await handler(
      new Request(`https://storybridge.test/api/v1/essays/${essayId}/audits`, {
        body: "{}",
        headers: {
          "content-type": "application/json",
          host: "storybridge.test",
          "idempotency-key": "audit-key-00000006",
          origin: "https://storybridge.test",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      essayId,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(audit).toHaveBeenCalledWith(essayId, {
      idempotencyKey: "audit-key-00000006",
    });
  });

  it("rejects undeclared audit input fields", async () => {
    const handler = createAuditPostHandler({
      appUrl: new URL("https://storybridge.test"),
      audit: vi.fn(),
    });
    const response = await handler(
      new Request(`https://storybridge.test/api/v1/essays/${essayId}/audits`, {
        body: JSON.stringify({ status: "PASS" }),
        headers: {
          "content-type": "application/json",
          host: "storybridge.test",
          "idempotency-key": "audit-key-00000007",
          origin: "https://storybridge.test",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      essayId,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("returns a retryable 503 when local similarity calculation fails", async () => {
    const handler = createAuditPostHandler({
      appUrl: new URL("https://storybridge.test"),
      audit: vi
        .fn()
        .mockRejectedValue(new AuditEssayError("SERVICE_UNAVAILABLE")),
    });
    const response = await handler(
      new Request(`https://storybridge.test/api/v1/essays/${essayId}/audits`, {
        body: "{}",
        headers: {
          "content-type": "application/json",
          host: "storybridge.test",
          "idempotency-key": "audit-key-00000009",
          origin: "https://storybridge.test",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      essayId,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SERVICE_UNAVAILABLE", retryable: true },
    });
  });
});
