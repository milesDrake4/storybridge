import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { auditIssueSchema, essayAuditSchema } from "@/contracts/http/v1/audits";
import { measureReferenceSimilarity } from "@/domain/audit/similarity";

describe("audit integrity evaluation", () => {
  it("keeps similarity local and deterministic", () => {
    const source = readFileSync(
      resolve(process.cwd(), "domain/audit/similarity.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/fetch\(|openai|provider|network/i);
    expect(
      measureReferenceSimilarity("ＨＥＬＬＯ, community!", "hello community"),
    ).toMatchObject({
      substantiallySimilar: true,
      thresholdCode: "SHORT_IDENTICAL",
    });
  });

  it("rejects untyped issue codes and malformed spans", () => {
    expect(
      auditIssueSchema.safeParse({
        code: "ADMISSION_CHANCE",
        evidenceIds: [],
        message: "Not allowed",
        severity: "BLOCKING",
      }).success,
    ).toBe(false);
    expect(
      auditIssueSchema.safeParse({
        code: "UNSUPPORTED_CLAIM",
        evidenceIds: [],
        end: 2,
        message: "Missing start",
        severity: "BLOCKING",
      }).success,
    ).toBe(false);
  });

  it("requires persisted status to agree with blocking issues", () => {
    const base = {
      createdAt: "2026-08-05T12:00:00.000Z",
      essayId: "ae100000-0000-4000-8000-000000000001",
      essayRevision: 3,
      evidenceManifestVersion: `v1.${"e".repeat(43)}`,
      id: "ae200000-0000-4000-8000-000000000001",
      issues: [
        {
          code: "WORD_LIMIT_EXCEEDED",
          evidenceIds: [],
          message: "Too long.",
          severity: "BLOCKING",
        },
      ],
      similarity: {
        distinctReferenceFourGramCount: 0,
        fourGramOverlapRatio: 0,
        longestContiguousMatch: 0,
        matchedReferenceFourGramCount: 0,
        referenceTokenCount: 0,
        studentTokenCount: 10,
        substantiallySimilar: false,
        thresholdCode: "NO_REFERENCE",
      },
      userId: "ae000000-0000-4000-8000-000000000001",
    };
    expect(
      essayAuditSchema.safeParse({ ...base, status: "PASS" }).success,
    ).toBe(false);
    expect(
      essayAuditSchema.safeParse({ ...base, status: "BLOCKED" }).success,
    ).toBe(true);
  });
});
