import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import moderationSignal from "@/tests/fixtures/openai/moderation-signal.json";
import responseRefusal from "@/tests/fixtures/openai/response-refusal.json";
import responseSchemaFailure from "@/tests/fixtures/openai/response-schema-failure.json";
import responseSuccess from "@/tests/fixtures/openai/response-success.json";
import timeoutFixture from "@/tests/fixtures/openai/timeout.json";
import {
  AiAdapterError,
  AI_PURPOSE_LIMITS,
  createOpenAiAdapters,
  createZodStructuredOutput,
  type OpenAiTransport,
} from "@/adapters/openai/client";
import type { UserId } from "@/contracts/domain/ids";

const userId = "018f4d68-41f2-78a1-9cb2-5ff8f82a6140" as UserId;
const output = createZodStructuredOutput(
  "synthetic_summary",
  z.strictObject({ summary: z.string() }),
);

function createTransport(response: unknown): {
  createModeration: ReturnType<typeof vi.fn>;
  createResponse: ReturnType<typeof vi.fn>;
  transport: OpenAiTransport;
} {
  const createResponse = vi.fn().mockResolvedValue(response);
  const createModeration = vi.fn().mockResolvedValue(moderationSignal);
  return {
    createModeration,
    createResponse,
    transport: { createModeration, createResponse },
  };
}

function createAdapters(transport: OpenAiTransport) {
  return createOpenAiAdapters(
    {
      contentHmacSecret: "test-content-hmac-secret-00000000002",
      maxOutputTokens: 4_000,
      model: "gpt-5.6-terra",
    },
    transport,
  );
}

describe("OpenAI adapter", () => {
  it("sends a private, bounded structured request and validates success", async () => {
    const { createResponse, transport } = createTransport(responseSuccess);
    const adapters = createAdapters(transport);

    await expect(
      adapters.structured.generate({
        input: "Synthetic fixture input.",
        instructions: "Return the synthetic fixture result.",
        output,
        purpose: "INTERVIEW_REPLY",
        userId,
      }),
    ).resolves.toEqual({
      model: "gpt-synthetic",
      requestId: "resp_synthetic_success",
      value: { summary: "Synthetic result" },
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });

    expect(createResponse).toHaveBeenCalledOnce();
    const [request, options] = createResponse.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(request).toMatchObject({
      input: "Synthetic fixture input.",
      instructions: "Return the synthetic fixture result.",
      max_output_tokens: AI_PURPOSE_LIMITS.INTERVIEW_REPLY.maxOutputTokens,
      model: "gpt-5.6-terra",
      store: false,
      text: {
        format: {
          name: "synthetic_summary",
          schema: output.jsonSchema,
          strict: true,
          type: "json_schema",
        },
      },
    });
    expect(request.safety_identifier).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(request.safety_identifier).not.toContain(userId);
    expect(options).toMatchObject({
      maxRetries: AI_PURPOSE_LIMITS.INTERVIEW_REPLY.maxRetries,
      timeout: AI_PURPOSE_LIMITS.INTERVIEW_REPLY.timeoutMs,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps schema failures and refusals to stable typed errors", async () => {
    const invalid = createAdapters(
      createTransport(responseSchemaFailure).transport,
    );
    const refused = createAdapters(createTransport(responseRefusal).transport);
    const request = {
      input: "Synthetic fixture input.",
      instructions: "Return the synthetic fixture result.",
      output,
      purpose: "STORY_EXTRACTION" as const,
      userId,
    };

    await expect(invalid.structured.generate(request)).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
    });
    await expect(refused.structured.generate(request)).rejects.toMatchObject({
      code: "PROVIDER_REFUSED",
    });
  });

  it("normalizes moderation signals without returning provider objects", async () => {
    const { createModeration, transport } = createTransport(responseSuccess);
    const adapters = createAdapters(transport);

    await expect(
      adapters.moderation.check({
        content: ["Synthetic moderation input."],
        purpose: "INTERVIEW_REPLY",
        userId,
      }),
    ).resolves.toEqual({
      categories: ["self-harm", "self-harm/intent"],
      flagged: true,
      model: "omni-moderation-latest",
      requestId: "modr_synthetic_signal",
      scores: {
        "self-harm": 0.91,
        "self-harm/intent": 0.88,
        violence: 0.02,
      },
    });
    expect(createModeration).toHaveBeenCalledWith(
      {
        input: ["Synthetic moderation input."],
        model: "omni-moderation-latest",
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("maps deadline failures without leaking provider messages", async () => {
    const timeout = Object.assign(new Error(timeoutFixture.error.message), {
      name: timeoutFixture.error.name,
    });
    const { transport } = createTransport(responseSuccess);
    transport.createResponse = vi.fn().mockRejectedValue(timeout);
    const adapters = createAdapters(transport);

    const failure = await adapters.structured
      .generate({
        input: "Synthetic fixture input.",
        instructions: "Return the synthetic fixture result.",
        output,
        purpose: "COACHING",
        userId,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiAdapterError);
    expect(failure).toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect((failure as Error).message).not.toContain(
      timeoutFixture.error.message,
    );
  });

  it("maps provider failures to a stable unavailable error", async () => {
    const { transport } = createTransport(responseSuccess);
    transport.createResponse = vi
      .fn()
      .mockRejectedValue(new Error("provider account and request details"));
    const adapters = createAdapters(transport);

    const failure = await adapters.structured
      .generate({
        input: "Synthetic fixture input.",
        instructions: "Return the synthetic fixture result.",
        output,
        purpose: "FINAL_REVIEW",
        userId,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiAdapterError);
    expect(failure).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((failure as Error).message).not.toContain("provider account");
  });
});
