"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { SchoolPicker } from "@/components/essay/school-picker";
import { ErrorSummary } from "@/components/ui/error-summary";
import {
  apiErrorSchema,
  apiSuccessSchema,
} from "@/contracts/http/v1/envelopes";
import { essayWorkspaceSchema } from "@/contracts/http/v1/essays";
import type { SchoolSummary } from "@/contracts/http/v1/schools";
import { hasPromptPrivacyRisk } from "@/services/essays/prompt-privacy";

type Props = {
  initialSchools?: SchoolSummary[];
  onCreated?(essayId: string): void;
};

type ErrorState = { message: string; recovery?: "ESSAYS" } | null;

async function json(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function EssaySetupForm({ initialSchools, onCreated }: Props) {
  const [school, setSchool] = useState<SchoolSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [wordLimit, setWordLimit] = useState("650");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  function validate(): ErrorState {
    if (!school)
      return {
        message:
          "Choose a school from the verified registry before continuing.",
      };
    const normalizedPrompt = prompt.normalize("NFKC").trim();
    if (normalizedPrompt.length < 25 || normalizedPrompt.length > 2_000) {
      return {
        message:
          "Enter the official application prompt using 25 to 2,000 characters.",
      };
    }
    if (hasPromptPrivacyRisk(normalizedPrompt)) {
      return {
        message:
          "Paste only the school's official prompt. Remove personal notes, draft sentences, and details about you.",
      };
    }
    const limit = Number(wordLimit);
    if (!Number.isInteger(limit) || limit < 25 || limit > 1_000) {
      return {
        message:
          "Enter the school's word limit as a whole number from 25 to 1,000.",
      };
    }
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (!school) return;
    const input = {
      prompt: prompt.normalize("NFKC").trim(),
      schoolId: school.id,
      wordLimit: Number(wordLimit),
    };
    const fingerprint = JSON.stringify(input);
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { fingerprint, key: crypto.randomUUID() };
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/essays", {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json",
          "idempotency-key": pending.current.key,
        },
        method: "POST",
      });
      const body = await json(response);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : null;
        if (code === "PROMPT_PRIVACY_RISK") {
          setError({
            message:
              "Paste only the school's official prompt. Remove personal notes, draft sentences, and details about you.",
          });
        } else if (code === "QUOTA_EXCEEDED") {
          setError({
            message:
              "Your current essay allowance is already in use. Deleting an essay does not restore it.",
            recovery: "ESSAYS",
          });
        } else if (code === "UNSUPPORTED_SCHOOL") {
          setError({
            message:
              "That school is no longer supported. Choose another verified school or request a review.",
          });
        } else if (code === "IDEMPOTENCY_KEY_REUSED") {
          pending.current = null;
          setError({
            message:
              "This request changed while it was being retried. Review the preserved fields and submit again.",
          });
        } else {
          setError({
            message:
              "The workspace was not created. Your selections are still here; try again.",
          });
        }
        return;
      }
      const parsed = apiSuccessSchema(essayWorkspaceSchema).safeParse(body);
      if (!parsed.success) throw new Error();
      pending.current = null;
      if (onCreated) onCreated(parsed.data.data.essay.id);
      else window.location.assign(`/essays/${parsed.data.data.essay.id}`);
    } catch {
      setError({
        message:
          "The workspace was not created. Your selections are still here; try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="essay-setup-form" onSubmit={(event) => void submit(event)}>
      <SchoolPicker
        initialSchools={initialSchools}
        onSelect={(next) => {
          setSchool(next);
          setError(null);
        }}
        value={school}
      />

      <div className="essay-prompt-field">
        <label className="field-label" htmlFor="essay-prompt">
          Official application prompt
        </label>
        <p id="essay-prompt-help">
          Copy the question from the school. Do not paste your response, notes,
          or personal details.
        </p>
        <textarea
          aria-describedby="essay-prompt-help essay-prompt-count"
          disabled={submitting}
          id="essay-prompt"
          maxLength={2_000}
          onChange={(event) => {
            setPrompt(event.target.value);
            setError(null);
          }}
          rows={6}
          value={prompt}
        />
        <p id="essay-prompt-count">{prompt.length} / 2,000 characters</p>
      </div>

      <div>
        <label className="field-label" htmlFor="essay-word-limit">
          Word limit
        </label>
        <input
          className="field-input essay-word-limit"
          disabled={submitting}
          id="essay-word-limit"
          inputMode="numeric"
          max={1_000}
          min={25}
          onChange={(event) => {
            setWordLimit(event.target.value);
            setError(null);
          }}
          step={1}
          type="number"
          value={wordLimit}
        />
      </div>

      {error ? (
        <ErrorSummary title="Check your essay setup">
          <p>{error.message}</p>
          {error.recovery === "ESSAYS" ? (
            <Link href="/essays">Open your essays</Link>
          ) : null}
        </ErrorSummary>
      ) : null}

      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
