import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import type {
  StructuredGeneration,
  StructuredOutputDefinition,
} from "@/contracts/domain/ai-ports";

export type AiAdapterErrorCode =
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REFUSED"
  | "PROVIDER_TIMEOUT"
  | "SERVICE_UNAVAILABLE";

export class AiAdapterError extends Error {
  readonly code: AiAdapterErrorCode;

  constructor(code: AiAdapterErrorCode) {
    super(code);
    this.name = "AiAdapterError";
    this.code = code;
  }
}

export function createZodStructuredOutput<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): StructuredOutputDefinition<z.output<Schema>> {
  const format = zodTextFormat(schema, name);
  return {
    jsonSchema: format.schema,
    name: format.name,
    parse: (value) => schema.parse(value),
  };
}

const contentPartSchema = z
  .object({
    refusal: z.string().optional(),
    text: z.string().optional(),
    type: z.string(),
  })
  .passthrough();

const responseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  output: z.array(
    z
      .object({
        content: z.array(contentPartSchema).optional(),
        type: z.string(),
      })
      .passthrough(),
  ),
  status: z.string(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});

export function parseStructuredResponse<Value>(
  response: unknown,
  output: StructuredOutputDefinition<Value>,
): StructuredGeneration<Value> {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AiAdapterError("PROVIDER_INVALID_RESPONSE");
  }

  const parts = parsed.data.output.flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === "refusal")) {
    throw new AiAdapterError("PROVIDER_REFUSED");
  }
  if (parsed.data.status !== "completed") {
    throw new AiAdapterError("PROVIDER_INVALID_RESPONSE");
  }

  const serialized = parts
    .filter(
      (part): part is typeof part & { text: string } =>
        part.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  if (!serialized) {
    throw new AiAdapterError("PROVIDER_INVALID_RESPONSE");
  }

  try {
    return {
      model: parsed.data.model,
      requestId: parsed.data.id,
      usage: {
        inputTokens: parsed.data.usage.input_tokens,
        outputTokens: parsed.data.usage.output_tokens,
        totalTokens: parsed.data.usage.total_tokens,
      },
      value: output.parse(JSON.parse(serialized) as unknown),
    };
  } catch (error) {
    if (error instanceof AiAdapterError) throw error;
    throw new AiAdapterError("PROVIDER_INVALID_RESPONSE");
  }
}

export function mapOpenAiError(error: unknown): AiAdapterError {
  if (
    error instanceof Error &&
    (error.name === "APIConnectionTimeoutError" ||
      error.name === "APIUserAbortError" ||
      error.name === "TimeoutError")
  ) {
    return new AiAdapterError("PROVIDER_TIMEOUT");
  }
  return new AiAdapterError("SERVICE_UNAVAILABLE");
}
