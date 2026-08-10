import { describe, expect, it, vi } from "vitest";

import {
  aiProviderMetricSchema,
  productAnalyticsEventSchema,
} from "@/contracts/domain/analytics";
import { createAnalyticsTracker } from "@/lib/analytics/track";

describe("content-free analytics allowlist", () => {
  it("accepts only named events with event-specific bounded properties", () => {
    expect(
      productAnalyticsEventSchema.parse({
        name: "interview_completed",
        properties: { durationMs: 120_000, questionCount: 9 },
      }),
    ).toEqual({
      name: "interview_completed",
      properties: { durationMs: 120_000, questionCount: 9 },
    });
    expect(() =>
      productAnalyticsEventSchema.parse({
        name: "admission_accepted",
        properties: {},
      }),
    ).toThrow();
    expect(() =>
      productAnalyticsEventSchema.parse({
        name: "essay_completed",
        properties: { essayText: "private draft", wordCount: 500 },
      }),
    ).toThrow();
  });

  it("rejects free text, URLs, and unknown AI metric fields", () => {
    const metric = {
      finalCostCents: 4,
      inputTokens: 1200,
      latencyMs: 800,
      modelId: "gpt-5.6-terra",
      outputTokens: 400,
      purpose: "COACHING",
      status: "SUCCEEDED",
    };
    expect(aiProviderMetricSchema.parse(metric)).toEqual(metric);
    expect(() =>
      aiProviderMetricSchema.parse({
        ...metric,
        sourceUrl: "https://example.edu/page?student=private",
      }),
    ).toThrow();
    expect(JSON.stringify(metric)).not.toContain("private");
  });

  it("validates before handing events to a telemetry sink", () => {
    const emit = vi.fn();
    const tracker = createAnalyticsTracker({ emit });

    tracker.track({
      name: "checkout_started",
      properties: { amountCents: 2499 },
    });
    expect(emit).toHaveBeenCalledWith({
      name: "checkout_started",
      properties: { amountCents: 2499 },
    });
    expect(() =>
      tracker.track({
        name: "checkout_started",
        properties: { amountCents: 2499, prompt: "private" },
      }),
    ).toThrow();
    expect(emit).toHaveBeenCalledOnce();
  });
});
