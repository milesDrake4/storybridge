import { describe, expect, it } from "vitest";

import {
  measureReferenceSimilarity,
  normalizeSimilarityText,
} from "@/domain/audit/similarity";

const tokens = (count: number, prefix = "word") =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

describe("deterministic reference similarity", () => {
  it("normalizes NFKC, case, punctuation, and whitespace", () => {
    expect(normalizeSimilarityText("  ＨＥＬＬＯ,\nWorld—again!  ")).toBe(
      "hello world again",
    );
    expect(
      measureReferenceSimilarity(
        "HELLO world again",
        "Ｈｅｌｌｏ, world—again!",
      ),
    ).toMatchObject({
      substantiallySimilar: true,
      thresholdCode: "SHORT_IDENTICAL",
    });
  });

  it("blocks short references only when normalized texts are identical", () => {
    const reference = tokens(39).join(" ");
    const student = `${reference} extra`;
    expect(measureReferenceSimilarity(student, reference)).toMatchObject({
      referenceTokenCount: 39,
      substantiallySimilar: false,
      thresholdCode: "SHORT_DISTINCT",
    });
  });

  it("uses the long-reference rules starting at exactly 40 tokens", () => {
    const reference = tokens(40).join(" ");
    const student = tokens(20).join(" ");
    expect(measureReferenceSimilarity(student, reference)).toMatchObject({
      referenceTokenCount: 40,
      substantiallySimilar: true,
      thresholdCode: "FOUR_GRAM_OVERLAP",
    });
  });

  it("blocks at the exact 45 percent distinct four-gram threshold", () => {
    const reference = tokens(43).join(" ");
    const atThreshold = tokens(21).join(" ");
    const belowThreshold = tokens(20).join(" ");
    expect(measureReferenceSimilarity(atThreshold, reference)).toMatchObject({
      distinctReferenceFourGramCount: 40,
      fourGramOverlapRatio: 0.45,
      matchedReferenceFourGramCount: 18,
      substantiallySimilar: true,
      thresholdCode: "FOUR_GRAM_OVERLAP",
    });
    expect(measureReferenceSimilarity(belowThreshold, reference)).toMatchObject(
      {
        fourGramOverlapRatio: 0.425,
        matchedReferenceFourGramCount: 17,
        substantiallySimilar: false,
        thresholdCode: "BELOW_THRESHOLD",
      },
    );
  });

  it("blocks a 30-token contiguous match independently of four-gram overlap", () => {
    const referenceTokens = tokens(100);
    const student = referenceTokens.slice(35, 65).join(" ");
    expect(
      measureReferenceSimilarity(student, referenceTokens.join(" ")),
    ).toMatchObject({
      longestContiguousMatch: 30,
      substantiallySimilar: true,
      thresholdCode: "CONTIGUOUS_MATCH",
    });
  });

  it("does not block a 29-token match below both long-text thresholds", () => {
    const referenceTokens = tokens(100);
    const student = referenceTokens.slice(35, 64).join(" ");
    expect(
      measureReferenceSimilarity(student, referenceTokens.join(" ")),
    ).toMatchObject({
      longestContiguousMatch: 29,
      substantiallySimilar: false,
      thresholdCode: "BELOW_THRESHOLD",
    });
  });

  it("counts distinct reference four-grams rather than duplicates", () => {
    const reference = Array.from({ length: 50 }, () => "same").join(" ");
    expect(
      measureReferenceSimilarity("same same same same", reference),
    ).toMatchObject({
      distinctReferenceFourGramCount: 1,
      matchedReferenceFourGramCount: 1,
      substantiallySimilar: true,
    });
  });
});
