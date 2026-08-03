import { describe, expect, it } from "vitest";

import {
  CONTINUATION_INSTRUCTIONS,
  REWRITE_INSTRUCTIONS,
} from "@/adapters/openai/revision";
import {
  continuationDraftSchema,
  rewriteInputSchema,
} from "@/contracts/http/v1/proposals";
import { createDraftTextHash } from "@/lib/security/draft-hash";

describe("rewrite and continuation safety contract", () => {
  it("permits custom text only for CUSTOM requests", () => {
    const selection = {
      end: 4,
      start: 0,
      textHash: createDraftTextHash("text"),
    };
    expect(
      rewriteInputSchema.safeParse({
        customInstruction: "Sound formal",
        instruction: "CLARIFY",
        selection,
      }).success,
    ).toBe(false);
    expect(
      rewriteInputSchema.safeParse({ instruction: "CUSTOM", selection })
        .success,
    ).toBe(false);
    expect(
      rewriteInputSchema.safeParse({
        customInstruction: "Sound formal",
        instruction: "CUSTOM",
        selection,
      }).success,
    ).toBe(true);
  });

  it("rejects more than three continuations or 100 words total", () => {
    const suggestion = {
      claims: [],
      proposedText: Array.from({ length: 51 }, () => "word").join(" "),
      rationale: "A transition.",
    };
    expect(
      continuationDraftSchema.safeParse({
        suggestions: [suggestion, suggestion],
      }).success,
    ).toBe(false);
    expect(
      continuationDraftSchema.safeParse({
        suggestions: Array.from({ length: 4 }, () => ({
          ...suggestion,
          proposedText: "brief",
        })),
      }).success,
    ).toBe(false);
  });

  it("instructs the model to preserve voice and block unsupported claims", () => {
    expect(REWRITE_INSTRUCTIONS).toMatch(
      /Preserve the student's established voice/i,
    );
    expect(REWRITE_INSTRUCTIONS).toMatch(/BLOCKING_UNSUPPORTED/);
    expect(CONTINUATION_INSTRUCTIONS).toMatch(/100 words total/i);
  });
});
