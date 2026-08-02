import type { UserId } from "@/contracts/domain/ids";

export const aiPurposes = [
  "INTERVIEW_REPLY",
  "STORY_EXTRACTION",
  "SCHOOL_RESEARCH",
  "ANGLE_GENERATION",
  "OUTLINE_GENERATION",
  "COACHING",
  "REWRITE",
  "CONTINUATION",
  "FINAL_REVIEW",
  "REFERENCE_DRAFT",
] as const;
export type AiPurpose = (typeof aiPurposes)[number];

export type StructuredOutputDefinition<Value> = {
  jsonSchema: Readonly<Record<string, unknown>>;
  name: string;
  parse(value: unknown): Value;
};

export type StructuredGenerationRequest<Value> = {
  input: string;
  instructions: string;
  output: StructuredOutputDefinition<Value>;
  purpose: AiPurpose;
  userId: UserId;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type StructuredGeneration<Value> = {
  model: string;
  requestId: string;
  usage: AiUsage;
  value: Value;
};

export interface StructuredGenerationPort {
  generate<Value>(
    request: StructuredGenerationRequest<Value>,
  ): Promise<StructuredGeneration<Value>>;
}

export type ModerationRequest = {
  content: readonly string[];
  purpose: AiPurpose;
  userId: UserId;
};

export type ModerationSignal = {
  categories: string[];
  flagged: boolean;
  model: string;
  requestId: string;
  scores: Record<string, number>;
};

export interface ModerationPort {
  check(request: ModerationRequest): Promise<ModerationSignal>;
}
