"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QuestionCard } from "@/components/interview/question-card";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import {
  interviewSessionSchema,
  interviewSessionWithMessagesSchema,
  interviewTurnSchema,
  type InterviewMessage,
  type InterviewSessionWithMessages,
} from "@/contracts/http/v1/interviews";

type SaveState = "CONFLICT" | "ERROR" | "IDLE" | "SAVED" | "SAVING";

type InterviewFlowProps = {
  initialSession?: InterviewSessionWithMessages | null;
};

const SELF_HARM_COPY =
  "Your wellbeing matters more than this interview. If you may be in immediate danger, contact local emergency services or a trusted person now. Your previous answers are still saved; this answer was not saved.";

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function mergeMessages(
  messages: InterviewMessage[],
  incoming: Array<InterviewMessage | null>,
): InterviewMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message) byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function InterviewFlow({ initialSession }: InterviewFlowProps) {
  const [session, setSession] = useState<InterviewSessionWithMessages | null>(
    initialSession ?? null,
  );
  const [loading, setLoading] = useState(initialSession === undefined);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("IDLE");
  const [notice, setNotice] = useState<string | null>(null);
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/interview-sessions/current", {
        cache: "no-store",
      });
      const body = await responseJson(response);
      if (response.status === 404) {
        setSession(null);
        return;
      }
      if (!response.ok) throw new Error("Interview load failed");
      const parsed = apiSuccessSchema(
        interviewSessionWithMessagesSchema,
      ).safeParse(body);
      if (!parsed.success) throw new Error("Interview response was invalid");
      setSession(parsed.data.data);
      setSaveState("IDLE");
    } catch {
      setNotice("We could not load your interview. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialSession !== undefined) return;
    const timeout = window.setTimeout(() => void loadCurrent(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialSession, loadCurrent]);

  const currentQuestion = useMemo(
    () =>
      session?.messages
        .filter(
          (message) =>
            message.role === "ASSISTANT" &&
            message.questionKey === session.currentQuestionKey,
        )
        .at(-1) ?? null,
    [session],
  );
  const savedAnswers = useMemo(
    () => session?.messages.filter((message) => message.role === "USER") ?? [],
    [session],
  );

  async function start() {
    setStarting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/interview-sessions", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey(),
        },
        method: "POST",
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error("Interview start failed");
      const parsed = apiSuccessSchema(interviewSessionSchema).safeParse(body);
      if (!parsed.success) throw new Error("Interview response was invalid");
      await loadCurrent();
    } catch {
      setNotice("We could not start your interview. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !currentQuestion || saveState === "SAVING") return;

    const answer = draft.trim();
    if (!answer) return;
    const fingerprint = `${currentQuestion.questionKey}\u0000${answer}`;
    if (pendingKey.current?.fingerprint !== fingerprint) {
      pendingKey.current = { fingerprint, key: idempotencyKey() };
    }

    setSaveState("SAVING");
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/interview-sessions/${session.id}/messages`,
        {
          body: JSON.stringify({
            answer,
            questionKey: currentQuestion.questionKey,
          }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": pendingKey.current.key,
          },
          method: "POST",
        },
      );
      const body = await responseJson(response);
      if (!response.ok) {
        const error = apiErrorSchema.safeParse(body);
        const code = error.success ? error.data.error.code : null;
        const safetyCode = error.success
          ? error.data.error.fieldErrors?.find(
              (field) => field.path === "answer",
            )?.code
          : null;
        if (safetyCode === "SELF_HARM") {
          setNotice(SELF_HARM_COPY);
          setSaveState("ERROR");
          return;
        }
        if (code === "STATE_CONFLICT") {
          setNotice(
            "This interview moved forward elsewhere. Reload the latest question before saving again.",
          );
          setSaveState("CONFLICT");
          return;
        }
        if (code === "VALIDATION_ERROR") {
          setNotice(
            "This answer was not saved. Please revise it before continuing.",
          );
        } else {
          setNotice("Save failed. Your draft is still here; please try again.");
        }
        setSaveState("ERROR");
        return;
      }

      const parsed = apiSuccessSchema(interviewTurnSchema).safeParse(body);
      if (!parsed.success) throw new Error("Interview response was invalid");
      const turn = parsed.data.data;
      setSession({
        ...turn.session,
        messages: mergeMessages(session.messages, [
          turn.answer,
          turn.nextQuestion,
        ]),
      });
      setDraft("");
      pendingKey.current = null;
      setSaveState("SAVED");
    } catch {
      setNotice("Save failed. Your draft is still here; please try again.");
      setSaveState("ERROR");
    }
  }

  if (loading) {
    return (
      <section className="interview-loading" aria-busy="true">
        <p className="eyebrow">Story interview</p>
        <h1>Loading your place…</h1>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="interview-intro" aria-labelledby="interview-heading">
        <p className="eyebrow">Story interview</p>
        <h1 id="interview-heading">Start with what only you know.</h1>
        <p>
          Nine questions will help organize the experiences, values, and voice
          you may want to draw on later. Pause whenever you need to—each
          confirmed answer is saved privately.
        </p>
        {notice ? <p role="alert">{notice}</p> : null}
        <button
          className="button button-primary"
          disabled={starting}
          onClick={() => void start()}
          type="button"
        >
          {starting ? "Starting…" : "Begin the interview"}
        </button>
      </section>
    );
  }

  if (session.status === "COMPLETE" || !currentQuestion) {
    return (
      <section
        className="interview-complete"
        aria-labelledby="complete-heading"
      >
        <p className="eyebrow">Interview complete</p>
        <h1 id="complete-heading">Your story has a foundation.</h1>
        <p>All nine answers are saved. Your Story Vault is ready for review.</p>
      </section>
    );
  }

  const questionNumber = Math.min(savedAnswers.length + 1, 9);
  const statusLabel =
    saveState === "SAVING"
      ? "Saving"
      : saveState === "SAVED"
        ? "Saved"
        : saveState === "CONFLICT"
          ? "Conflict"
          : saveState === "ERROR"
            ? "Save failed"
            : "Ready";

  return (
    <section
      className="interview-workspace"
      aria-labelledby="interview-question"
    >
      <div className="interview-progress-panel">
        <div className="progress-heading">
          <p className="eyebrow">Story interview</p>
          <span>{questionNumber} / 9</span>
        </div>
        <progress
          aria-label="Interview progress"
          max={9}
          value={savedAnswers.length}
        />
        <p className="progress-copy">
          {savedAnswers.length === 0
            ? "Nothing has been saved yet."
            : `${savedAnswers.length} ${savedAnswers.length === 1 ? "answer" : "answers"} safely stored.`}
        </p>

        {savedAnswers.length > 0 ? (
          <div className="interview-transcript" aria-labelledby="saved-heading">
            <h2 id="saved-heading">Your saved answers</h2>
            <ol>
              {savedAnswers.map((answer) => (
                <li key={answer.id}>
                  <span>Question {Math.floor(answer.sequence / 2) + 1}</span>
                  <p>{answer.content}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="interview-question-panel">
        <div
          className="save-indicator"
          data-state={saveState.toLowerCase()}
          role="status"
        >
          <span aria-hidden="true" />
          {statusLabel}
        </div>
        {notice ? (
          <p className="interview-notice" role="alert">
            {notice}
          </p>
        ) : null}
        {saveState === "CONFLICT" ? (
          <button
            className="button button-secondary conflict-reload"
            onClick={() => void loadCurrent()}
            type="button"
          >
            Reload latest question
          </button>
        ) : null}
        <QuestionCard
          answer={draft}
          disabled={saveState === "SAVING"}
          onAnswerChange={(answer) => {
            setDraft(answer);
            setNotice(null);
            if (saveState !== "SAVING") setSaveState("IDLE");
          }}
          onSubmit={(event) => void submit(event)}
          question={currentQuestion.content}
          questionNumber={questionNumber}
        />
      </div>
    </section>
  );
}
