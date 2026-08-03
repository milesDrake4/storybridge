"use client";

import { useRef, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  adviceProposalSchema,
  type AdviceProposal,
} from "@/contracts/http/v1/proposals";

export function CoachPanel({ essayId }: { essayId: string }) {
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState<AdviceProposal | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  async function ask() {
    setWorking(true);
    setNotice(null);
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/v1/essays/${essayId}/coach-proposals`,
        {
          body: JSON.stringify({ question }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": key.current,
          },
          method: "POST",
        },
      );
      const parsed = apiSuccessSchema(adviceProposalSchema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) {
        setNotice(
          "Coaching is unavailable right now. Your draft and question are still here.",
        );
        return;
      }
      key.current = null;
      setAdvice(parsed.data.data);
    } catch {
      setNotice(
        "Coaching is unavailable right now. Your draft and question are still here.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="coach-panel" aria-labelledby="coach-heading">
      <p className="eyebrow">Advice only</p>
      <h2 id="coach-heading">Ask your essay coach</h2>
      <p>
        The coach gives revision guidance. It cannot insert or change any part
        of your draft.
      </p>
      <label>
        What would you like help with?
        <textarea
          maxLength={2_000}
          onChange={(event) => setQuestion(event.target.value)}
          value={question}
        />
      </label>
      <button
        className="button button-secondary"
        disabled={working || !question.trim()}
        onClick={() => void ask()}
        type="button"
      >
        {working ? "Thinking…" : "Get coaching advice"}
      </button>
      {notice ? <p role="alert">{notice}</p> : null}
      {advice ? (
        <article className="coach-advice">
          <h3>{advice.headline}</h3>
          <ol>
            {advice.guidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <p>{advice.rationale}</p>
          <p className="eyebrow">Advice only · no insertion action</p>
        </article>
      ) : null}
    </section>
  );
}
