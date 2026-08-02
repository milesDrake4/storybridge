import { z } from "zod";

import {
  interviewMessageIdSchema,
  interviewSessionIdSchema,
  userIdSchema,
} from "@/contracts/domain/ids";
import { rfc3339UtcSchema } from "@/contracts/http/v1/common";

export const interviewQuestionKeySchema = z.enum([
  "ACADEMIC_INTERESTS",
  "EXPERIENCE_CHALLENGE",
  "EXPERIENCE_PRIDE",
  "ACTIVITIES",
  "RESPONSIBILITIES",
  "VALUES",
  "GOALS",
  "VOICE",
  "ADDITIONAL_CONTEXT",
]);
export type InterviewQuestionKey = z.infer<typeof interviewQuestionKeySchema>;

export const interviewCoverageSchema = z.strictObject({
  academicInterests: z.boolean(),
  activities: z.boolean(),
  experiences: z.number().int().min(0).max(3),
  goals: z.boolean(),
  responsibilities: z.boolean(),
  values: z.boolean(),
  voice: z.boolean(),
});

export const interviewSessionSchema = z.object({
  completedAt: rfc3339UtcSchema.nullable(),
  coverage: interviewCoverageSchema,
  createdAt: rfc3339UtcSchema,
  currentQuestionKey: interviewQuestionKeySchema.nullable(),
  id: interviewSessionIdSchema,
  status: z.enum(["ACTIVE", "COMPLETE"]),
  updatedAt: rfc3339UtcSchema,
  userId: userIdSchema,
});
export type InterviewSession = z.infer<typeof interviewSessionSchema>;

export const interviewMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  createdAt: rfc3339UtcSchema,
  id: interviewMessageIdSchema,
  questionKey: interviewQuestionKeySchema,
  role: z.enum(["ASSISTANT", "USER"]),
  sequence: z.number().int().nonnegative(),
  sessionId: interviewSessionIdSchema,
  userId: userIdSchema,
});
export type InterviewMessage = z.infer<typeof interviewMessageSchema>;

export const interviewAnswerInputSchema = z.strictObject({
  answer: z.string().min(1).max(4000),
  questionKey: interviewQuestionKeySchema,
});
export type InterviewAnswerInput = z.infer<typeof interviewAnswerInputSchema>;

export const interviewSessionWithMessagesSchema = interviewSessionSchema.extend(
  {
    messages: z.array(interviewMessageSchema),
  },
);
export type InterviewSessionWithMessages = z.infer<
  typeof interviewSessionWithMessagesSchema
>;

export const interviewTurnSchema = z.object({
  answer: interviewMessageSchema,
  nextQuestion: interviewMessageSchema.nullable(),
  session: interviewSessionSchema,
});
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;
