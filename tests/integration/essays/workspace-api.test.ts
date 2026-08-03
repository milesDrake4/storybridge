import { describe, expect, it } from "vitest";

import {
  createEssayInputSchema,
  essayListQuerySchema,
} from "@/contracts/http/v1/essays";
import { hasPromptPrivacyRisk } from "@/services/essays/prompt-privacy";

const schoolId = "f1000000-0000-4000-8000-000000000001";

describe("essay workspace contracts", () => {
  it("accepts only a registry school, prompt, and word limit on creation", () => {
    expect(
      createEssayInputSchema.parse({
        prompt: "What community has shaped how you see the world today?",
        schoolId,
        wordLimit: 500,
      }),
    ).toEqual({
      prompt: "What community has shaped how you see the world today?",
      schoolId,
      wordLimit: 500,
    });

    for (const extra of [
      { officialDomain: "attacker.example" },
      { status: "COMPLETE" },
      { userId: "f0000000-0000-4000-8000-000000000099" },
    ]) {
      expect(() =>
        createEssayInputSchema.parse({
          prompt: "What community has shaped how you see the world today?",
          schoolId,
          wordLimit: 500,
          ...extra,
        }),
      ).toThrow();
    }
  });

  it("enforces prompt and word-limit boundaries", () => {
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "too short",
        schoolId,
        wordLimit: 500,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "x".repeat(2_001),
        schoolId,
        wordLimit: 500,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "Describe a meaningful contribution to your community.",
        schoolId,
        wordLimit: 24,
      }),
    ).toThrow();
    expect(() =>
      createEssayInputSchema.parse({
        prompt: "Describe a meaningful contribution to your community.",
        schoolId,
        wordLimit: 1_001,
      }),
    ).toThrow();
  });

  it("accepts only bounded list pagination fields", () => {
    expect(essayListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(() => essayListQuerySchema.parse({ limit: 51 })).toThrow();
    expect(() => essayListQuerySchema.parse({ ownerId: schoolId })).toThrow();
  });
});

describe("essay prompt privacy classifier", () => {
  it("allows server-facing school prompt text", () => {
    expect(
      hasPromptPrivacyRisk(
        "Describe a community that has shaped your perspective and how you would contribute to campus.",
      ),
    ).toBe(false);
  });

  it.each([
    "Here is my essay draft: I grew up translating for my parents.",
    "My personal statement explains how my family moved three times.",
    "I learned resilience when I led my robotics team through a difficult season.",
    "Notes about me: my GPA is 3.8 and I volunteer at the hospital.",
  ])("flags likely personal notes or essay prose: %s", (prompt) => {
    expect(hasPromptPrivacyRisk(prompt)).toBe(true);
  });
});
