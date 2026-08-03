import { describe, expect, it } from "vitest";

import { outlineProposalDraftSchema } from "@/contracts/http/v1/outlines";

const factId = "e1000000-0000-4000-8000-000000000001";
const sourceId = "e2000000-0000-4000-8000-000000000001";
const section = (index: number) => ({
  id: `e3000000-0000-4000-8000-00000000000${index}`,
  purpose: `Section purpose ${index}`,
  schoolSourceIds: [sourceId],
  storyFactIds: [factId],
  targetWords: 75,
});

describe("outline proposal evaluation gates", () => {
  it("accepts a bounded four-section evidence-linked outline", () => {
    expect(
      outlineProposalDraftSchema.safeParse({
        outline: {
          schemaVersion: "1",
          sections: [1, 2, 3, 4].map(section),
        },
        rationale:
          "A specific progression from experience to school connection.",
      }).success,
    ).toBe(true);
  });

  it("rejects partial, evidence-free, and duplicate-section output", () => {
    expect(
      outlineProposalDraftSchema.safeParse({
        outline: { schemaVersion: "1", sections: [section(1), section(2)] },
        rationale: "Too short.",
      }).success,
    ).toBe(false);
    expect(
      outlineProposalDraftSchema.safeParse({
        outline: {
          schemaVersion: "1",
          sections: [
            { ...section(1), storyFactIds: [] },
            section(2),
            section(3),
          ],
        },
        rationale: "Missing evidence.",
      }).success,
    ).toBe(false);
    expect(
      outlineProposalDraftSchema.safeParse({
        outline: {
          schemaVersion: "1",
          sections: [section(1), section(1), section(3)],
        },
        rationale: "Duplicate IDs.",
      }).success,
    ).toBe(false);
  });
});
