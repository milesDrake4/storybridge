import { createHmac } from "node:crypto";

import OpenAI from "openai";

import { createOpenAiModerationPort } from "@/adapters/openai/moderation";
import {
  AiAdapterError,
  mapOpenAiError,
  parseStructuredResponse,
} from "@/adapters/openai/structured-response";
import type {
  AiPurpose,
  ModerationPort,
  StructuredGenerationPort,
} from "@/contracts/domain/ai-ports";
import type { UserId } from "@/contracts/domain/ids";
import type { ServerConfig } from "@/lib/config/server";

export type OpenAiRequestOptions = {
  maxRetries: number;
  signal: AbortSignal;
  timeout: number;
};

export type OpenAiResponseRequest = {
  include?: ["web_search_call.action.sources"];
  input: string;
  instructions: string;
  max_output_tokens: number;
  model: string;
  safety_identifier: string;
  store: false;
  text: {
    format: {
      name: string;
      schema: Readonly<Record<string, unknown>>;
      strict: true;
      type: "json_schema";
    };
  };
  tool_choice?: "required";
  tools?: Array<{
    filters: { allowed_domains: string[] };
    search_context_size?: "low" | "medium" | "high";
    type: "web_search";
  }>;
};

type OpenAiModerationRequest = {
  input: string[];
  model: "omni-moderation-latest";
};

export interface OpenAiTransport {
  createModeration(
    request: OpenAiModerationRequest,
    options: OpenAiRequestOptions,
  ): Promise<unknown>;
  createResponse(
    request: OpenAiResponseRequest,
    options: OpenAiRequestOptions,
  ): Promise<unknown>;
}

export const AI_PURPOSE_LIMITS = {
  ANGLE_GENERATION: {
    maxOutputTokens: 1_800,
    maxRetries: 2,
    timeoutMs: 45_000,
  },
  COACHING: { maxOutputTokens: 1_000, maxRetries: 2, timeoutMs: 30_000 },
  CONTINUATION: { maxOutputTokens: 400, maxRetries: 2, timeoutMs: 30_000 },
  FINAL_REVIEW: { maxOutputTokens: 1_800, maxRetries: 2, timeoutMs: 45_000 },
  INTERVIEW_REPLY: { maxOutputTokens: 800, maxRetries: 2, timeoutMs: 30_000 },
  OUTLINE_GENERATION: {
    maxOutputTokens: 2_400,
    maxRetries: 2,
    timeoutMs: 45_000,
  },
  REFERENCE_DRAFT: { maxOutputTokens: 4_000, maxRetries: 2, timeoutMs: 60_000 },
  REWRITE: { maxOutputTokens: 800, maxRetries: 2, timeoutMs: 30_000 },
  SCHOOL_RESEARCH: { maxOutputTokens: 3_000, maxRetries: 2, timeoutMs: 90_000 },
  STORY_EXTRACTION: {
    maxOutputTokens: 2_400,
    maxRetries: 2,
    timeoutMs: 60_000,
  },
} as const satisfies Record<
  AiPurpose,
  { maxOutputTokens: number; maxRetries: number; timeoutMs: number }
>;

type OpenAiAdapterConfig = {
  contentHmacSecret: string;
  maxOutputTokens: number;
  model: string;
};

export function createOpenAiSafetyIdentifier(
  userId: UserId,
  secret: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`storybridge:OPENAI_SAFETY:${userId}`, "utf8")
    .digest("base64url");
  return `v1.${digest}`;
}

export function createSdkOpenAiTransport(apiKey: string): OpenAiTransport {
  const client = new OpenAI({ apiKey });
  return {
    createModeration: (request, options) =>
      client.moderations.create(request, options),
    createResponse: (request, options) =>
      client.responses.create(request, options),
  };
}

export function createOpenAiAdapters(
  config: OpenAiAdapterConfig,
  transport: OpenAiTransport,
): { moderation: ModerationPort; structured: StructuredGenerationPort } {
  const structured: StructuredGenerationPort = {
    async generate(request) {
      const limits = AI_PURPOSE_LIMITS[request.purpose];
      try {
        const response = await transport.createResponse(
          {
            input: request.input,
            instructions: request.instructions,
            max_output_tokens: Math.min(
              limits.maxOutputTokens,
              config.maxOutputTokens,
            ),
            model: config.model,
            safety_identifier: createOpenAiSafetyIdentifier(
              request.userId,
              config.contentHmacSecret,
            ),
            store: false,
            text: {
              format: {
                name: request.output.name,
                schema: request.output.jsonSchema,
                strict: true,
                type: "json_schema",
              },
            },
          },
          {
            maxRetries: limits.maxRetries,
            signal: AbortSignal.timeout(limits.timeoutMs),
            timeout: limits.timeoutMs,
          },
        );
        return parseStructuredResponse(response, request.output);
      } catch (error) {
        if (error instanceof AiAdapterError) throw error;
        throw mapOpenAiError(error);
      }
    },
  };

  return {
    moderation: createOpenAiModerationPort(transport),
    structured,
  };
}

export function createConfiguredOpenAiAdapters(config: ServerConfig) {
  return createOpenAiAdapters(
    {
      contentHmacSecret: config.hmacSecrets.content,
      maxOutputTokens: config.maxAiOutputTokens,
      model: config.openAiModel,
    },
    createSdkOpenAiTransport(config.openAiApiKey),
  );
}

export { AiAdapterError } from "@/adapters/openai/structured-response";
export { createZodStructuredOutput } from "@/adapters/openai/structured-response";
