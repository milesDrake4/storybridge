import { describe, expect, it, vi } from "vitest";

import {
  createReferenceDraftGenerationAdapter,
  REFERENCE_DRAFT_INSTRUCTIONS,
} from "@/adapters/openai/reference-draft";
import {
  CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
  referenceDraftDraftSchema,
  referenceDraftInputSchema,
} from "@/contracts/http/v1/reference-drafts";

describe("reference draft safety contract", () => {
  it("requires the current acknowledgment version and rejects extra fields", () => {
    expect(
      referenceDraftInputSchema.safeParse({
        acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
      }).success,
    ).toBe(true);
    expect(
      referenceDraftInputSchema.safeParse({
        acknowledgmentVersion: "old-version",
      }).success,
    ).toBe(false);
    expect(
      referenceDraftInputSchema.safeParse({
        acknowledgmentVersion: CURRENT_REFERENCE_ACKNOWLEDGMENT_VERSION,
        accepted: true,
      }).success,
    ).toBe(false);
  });

  it("rejects claims without evidence or a valid source span", () => {
    const base = {
      claims: [
        {
          end: 4,
          schoolSourceIds: [],
          start: 0,
          storyFactIds: [],
          text: "Fact",
        },
      ],
      rationale: "A reference structure.",
      referenceText: "Fact",
    };
    expect(referenceDraftDraftSchema.safeParse(base).success).toBe(false);
    expect(
      referenceDraftDraftSchema.safeParse({
        ...base,
        claims: [
          {
            ...base.claims[0],
            end: 0,
            storyFactIds: ["e1000000-0000-4000-8000-000000000001"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("instructs the model to manifest every factual sentence and never invent", () => {
    expect(REFERENCE_DRAFT_INSTRUCTIONS).toMatch(
      /every factual sentence or factual sentence fragment/i,
    );
    expect(REFERENCE_DRAFT_INSTRUCTIONS).toMatch(/Never invent/i);
    expect(REFERENCE_DRAFT_INSTRUCTIONS).toMatch(/read-only reference/i);
    expect(REFERENCE_DRAFT_INSTRUCTIONS).toMatch(/Unicode code-point/i);
  });

  it("sends only bounded evidence context and no editable student draft", async () => {
    const generate = vi.fn().mockResolvedValue({});
    const adapter = createReferenceDraftGenerationAdapter({
      generate,
    });
    await adapter.generate({
      essay: {
        draftText: "This editable draft must not be sent.",
        prompt: "Describe your community.",
        wordLimit: 300,
      } as never,
      facts: [
        {
          details: ["Repaired bicycles."],
          id: "e2000000-0000-4000-8000-000000000001",
          summary: "Bicycle repair.",
        } as never,
      ],
      outline: { schemaVersion: "1", sections: [] } as never,
      schoolSources: [
        {
          claim: "Community partnerships exist.",
          id: "e3000000-0000-4000-8000-000000000001",
          supportingExcerpt: "Partnerships.",
        } as never,
      ],
      userId: "e4000000-0000-4000-8000-000000000001" as never,
      voiceProfile: {
        sentenceStyle: "Direct.",
        toneTraits: ["reflective"],
        vocabulary: "Plain.",
      },
    });
    const request = generate.mock.calls[0]?.[0];
    expect(request.purpose).toBe("REFERENCE_DRAFT");
    expect(request.input).not.toContain(
      "This editable draft must not be sent.",
    );
    expect(request.input).toContain("Repaired bicycles.");
    expect(request.input).toContain("Community partnerships exist.");
  });
});
