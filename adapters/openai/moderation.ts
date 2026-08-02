import { z } from "zod";

import type {
  ModerationPort,
  ModerationSignal,
} from "@/contracts/domain/ai-ports";
import type { OpenAiTransport } from "@/adapters/openai/client";
import {
  AiAdapterError,
  mapOpenAiError,
} from "@/adapters/openai/structured-response";

const MODERATION_MODEL = "omni-moderation-latest";
const MODERATION_TIMEOUT_MS = 15_000;

const moderationResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  results: z
    .array(
      z.object({
        categories: z.record(z.string(), z.boolean()),
        category_scores: z.record(z.string(), z.number().min(0).max(1)),
        flagged: z.boolean(),
      }),
    )
    .length(1),
});

function normalizeModeration(response: unknown): ModerationSignal {
  const parsed = moderationResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AiAdapterError("PROVIDER_INVALID_RESPONSE");
  }
  const result = parsed.data.results[0];
  return {
    categories: Object.entries(result.categories)
      .filter(([, flagged]) => flagged)
      .map(([category]) => category)
      .sort(),
    flagged: result.flagged,
    model: parsed.data.model,
    requestId: parsed.data.id,
    scores: result.category_scores,
  };
}

export function createOpenAiModerationPort(
  transport: OpenAiTransport,
): ModerationPort {
  return {
    async check(request) {
      try {
        const response = await transport.createModeration(
          { input: [...request.content], model: MODERATION_MODEL },
          {
            maxRetries: 1,
            signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
            timeout: MODERATION_TIMEOUT_MS,
          },
        );
        return normalizeModeration(response);
      } catch (error) {
        if (error instanceof AiAdapterError) throw error;
        throw mapOpenAiError(error);
      }
    },
  };
}
