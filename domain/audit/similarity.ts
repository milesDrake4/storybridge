import type { SimilarityMetrics } from "@/contracts/http/v1/audits";

const LONG_REFERENCE_TOKEN_THRESHOLD = 40;
const FOUR_GRAM_SIZE = 4;
const FOUR_GRAM_OVERLAP_THRESHOLD = 0.45;
const CONTIGUOUS_MATCH_THRESHOLD = 30;

export function normalizeSimilarityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function tokenizeSimilarityText(value: string): string[] {
  const normalized = normalizeSimilarityText(value);
  return normalized ? normalized.split(" ") : [];
}

function distinctNgrams(tokens: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join("\u0000"));
  }
  return grams;
}

function longestContiguousMatch(left: string[], right: string[]): number {
  let longest = 0;
  let previous = new Uint16Array(right.length + 1);
  for (const leftToken of left) {
    const current = new Uint16Array(right.length + 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (leftToken === right[rightIndex - 1]) {
        current[rightIndex] = previous[rightIndex - 1] + 1;
        longest = Math.max(longest, current[rightIndex]);
      }
    }
    previous = current;
  }
  return longest;
}

export function measureReferenceSimilarity(
  studentText: string,
  referenceText: string,
): SimilarityMetrics {
  const normalizedStudent = normalizeSimilarityText(studentText);
  const normalizedReference = normalizeSimilarityText(referenceText);
  const studentTokens = normalizedStudent ? normalizedStudent.split(" ") : [];
  const referenceTokens = normalizedReference
    ? normalizedReference.split(" ")
    : [];
  const referenceFourGrams = distinctNgrams(referenceTokens, FOUR_GRAM_SIZE);
  const studentFourGrams = distinctNgrams(studentTokens, FOUR_GRAM_SIZE);
  let matchedReferenceFourGramCount = 0;
  for (const gram of referenceFourGrams) {
    if (studentFourGrams.has(gram)) matchedReferenceFourGramCount += 1;
  }
  const fourGramOverlapRatio = referenceFourGrams.size
    ? matchedReferenceFourGramCount / referenceFourGrams.size
    : 0;
  const contiguousMatch = longestContiguousMatch(
    referenceTokens,
    studentTokens,
  );

  if (referenceTokens.length < LONG_REFERENCE_TOKEN_THRESHOLD) {
    const substantiallySimilar = normalizedReference === normalizedStudent;
    return {
      distinctReferenceFourGramCount: referenceFourGrams.size,
      fourGramOverlapRatio,
      longestContiguousMatch: contiguousMatch,
      matchedReferenceFourGramCount,
      referenceTokenCount: referenceTokens.length,
      studentTokenCount: studentTokens.length,
      substantiallySimilar,
      thresholdCode: substantiallySimilar
        ? "SHORT_IDENTICAL"
        : "SHORT_DISTINCT",
    };
  }

  const overlaps = fourGramOverlapRatio >= FOUR_GRAM_OVERLAP_THRESHOLD;
  const hasLongMatch = contiguousMatch >= CONTIGUOUS_MATCH_THRESHOLD;
  return {
    distinctReferenceFourGramCount: referenceFourGrams.size,
    fourGramOverlapRatio,
    longestContiguousMatch: contiguousMatch,
    matchedReferenceFourGramCount,
    referenceTokenCount: referenceTokens.length,
    studentTokenCount: studentTokens.length,
    substantiallySimilar: overlaps || hasLongMatch,
    thresholdCode: overlaps
      ? "FOUR_GRAM_OVERLAP"
      : hasLongMatch
        ? "CONTIGUOUS_MATCH"
        : "BELOW_THRESHOLD",
  };
}

export function noReferenceSimilarity(studentText: string): SimilarityMetrics {
  return {
    distinctReferenceFourGramCount: 0,
    fourGramOverlapRatio: 0,
    longestContiguousMatch: 0,
    matchedReferenceFourGramCount: 0,
    referenceTokenCount: 0,
    studentTokenCount: tokenizeSimilarityText(studentText).length,
    substantiallySimilar: false,
    thresholdCode: "NO_REFERENCE",
  };
}
