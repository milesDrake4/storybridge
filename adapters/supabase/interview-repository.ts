import { z } from "zod";

import { createSupabaseSecretClient } from "@/adapters/supabase/client";
import type { Database } from "@/adapters/supabase/database.types";
import {
  interviewMessageSchema,
  interviewSessionSchema,
  interviewTurnSchema,
  type InterviewMessage,
  type InterviewSession,
} from "@/contracts/http/v1/interviews";
import type { ServerConfig } from "@/lib/config/server";
import {
  InterviewSequenceError,
  type InterviewRepository,
} from "@/repositories/interview-repository";

type SessionRow = Database["public"]["Tables"]["interview_sessions"]["Row"];
type MessageRow = Database["public"]["Tables"]["interview_messages"]["Row"];

const sessionRowSchema = z.object({
  completed_at: z.string().nullable(),
  coverage: z.unknown(),
  created_at: z.string(),
  current_question_key: z.string().nullable(),
  id: z.string(),
  next_sequence: z.number().int().nonnegative(),
  status: z.string(),
  updated_at: z.string(),
  user_id: z.string(),
});

const messageRowSchema = z.object({
  content: z.string(),
  created_at: z.string(),
  id: z.string(),
  question_key: z.string(),
  role: z.string(),
  sequence: z.number().int().nonnegative(),
  session_id: z.string(),
  user_id: z.string(),
});

const turnRowSchema = z.object({
  answer: messageRowSchema,
  nextQuestion: messageRowSchema.nullable(),
  session: sessionRowSchema,
});

function utc(value: string): string {
  return new Date(value).toISOString();
}

export function mapInterviewSessionRow(row: SessionRow): InterviewSession {
  return interviewSessionSchema.parse({
    completedAt: row.completed_at === null ? null : utc(row.completed_at),
    coverage: row.coverage,
    createdAt: utc(row.created_at),
    currentQuestionKey: row.current_question_key,
    id: row.id,
    status: row.status,
    updatedAt: utc(row.updated_at),
    userId: row.user_id,
  });
}

export function mapInterviewMessageRow(row: MessageRow): InterviewMessage {
  return interviewMessageSchema.parse({
    content: row.content,
    createdAt: utc(row.created_at),
    id: row.id,
    questionKey: row.question_key,
    role: row.role,
    sequence: row.sequence,
    sessionId: row.session_id,
    userId: row.user_id,
  });
}

function mapTurn(value: unknown) {
  const row = turnRowSchema.parse(value);
  return interviewTurnSchema.parse({
    answer: mapInterviewMessageRow(row.answer as MessageRow),
    nextQuestion:
      row.nextQuestion === null
        ? null
        : mapInterviewMessageRow(row.nextQuestion as MessageRow),
    session: mapInterviewSessionRow(row.session as SessionRow),
  });
}

export function createSupabaseInterviewRepository(
  config: ServerConfig,
): InterviewRepository {
  const client = createSupabaseSecretClient(config);

  return {
    async start(userId, now) {
      const { data, error } = await client
        .schema("private")
        .rpc("start_interview_session", {
          requested_at: now.toISOString(),
          requested_user_id: userId,
        });
      if (error) throw error;
      return mapInterviewSessionRow(sessionRowSchema.parse(data) as SessionRow);
    },

    async getCurrent(userId) {
      const { data: session, error: sessionError } = await client
        .from("interview_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return null;

      const { data: messages, error: messagesError } = await client
        .from("interview_messages")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", session.id)
        .order("sequence", { ascending: true });
      if (messagesError) throw messagesError;

      return {
        ...mapInterviewSessionRow(session),
        messages: (messages ?? []).map(mapInterviewMessageRow),
      };
    },

    async getTurn(userId, answerId) {
      const { data: answer, error: answerError } = await client
        .from("interview_messages")
        .select("*")
        .eq("user_id", userId)
        .eq("id", answerId)
        .eq("role", "USER")
        .maybeSingle();
      if (answerError) throw answerError;
      if (!answer) return null;

      const [{ data: session, error: sessionError }, nextResult] =
        await Promise.all([
          client
            .from("interview_sessions")
            .select("*")
            .eq("user_id", userId)
            .eq("id", answer.session_id)
            .maybeSingle(),
          client
            .from("interview_messages")
            .select("*")
            .eq("user_id", userId)
            .eq("session_id", answer.session_id)
            .eq("sequence", answer.sequence + 1)
            .eq("role", "ASSISTANT")
            .maybeSingle(),
        ]);
      if (sessionError) throw sessionError;
      if (nextResult.error) throw nextResult.error;
      if (!session) return null;

      return interviewTurnSchema.parse({
        answer: mapInterviewMessageRow(answer),
        nextQuestion: nextResult.data
          ? mapInterviewMessageRow(nextResult.data)
          : null,
        session: mapInterviewSessionRow(session),
      });
    },

    async recordAnswer(input) {
      const { data, error } = await client
        .schema("private")
        .rpc("record_interview_answer", {
          requested_answer: input.answer,
          requested_at: input.now.toISOString(),
          requested_question_key: input.questionKey,
          requested_session_id: input.sessionId,
          requested_user_id: input.userId,
        });
      if (error?.code === "P0001") throw new InterviewSequenceError();
      if (error) throw error;
      return data === null ? null : mapTurn(data);
    },
  };
}
