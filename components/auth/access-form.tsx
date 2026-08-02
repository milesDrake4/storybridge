"use client";

import { type FormEvent, useState } from "react";

type AccessFormProps = {
  initialError?: string;
  inviteToken?: string;
};

const CALLBACK_ERROR =
  "That sign-in link could not be used. Request a new one below.";
const INVITATION_ERROR =
  "This account does not have an active beta invitation. Use the email and invitation link you received.";
const AGE_RESTRICTION_ERROR =
  "The closed beta is currently limited to people age 18 or older.";
const REQUEST_ERROR = "We could not send a link right now. Please try again.";
const RATE_LIMIT_ERROR =
  "Too many links were requested. Please wait and try again later.";
const SUCCESS_MESSAGE =
  "If your invitation is valid, your sign-in link is on its way. Check your inbox and spam folder.";

export function AccessForm({ initialError, inviteToken }: AccessFormProps) {
  const initialMessage =
    initialError === "AUTH_CALLBACK_FAILED"
      ? CALLBACK_ERROR
      : initialError === "INVITATION_REQUIRED"
        ? INVITATION_ERROR
        : initialError === "BETA_AGE_RESTRICTED"
          ? AGE_RESTRICTION_ERROR
          : "";
  const [message, setMessage] = useState(initialMessage);
  const [messageKind, setMessageKind] = useState<"error" | "success">(
    initialMessage ? "error" : "success",
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/magic-links", {
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          ...(inviteToken ? { inviteToken } : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (response.status === 202) {
        setMessageKind("success");
        setMessage(SUCCESS_MESSAGE);
      } else {
        setMessageKind("error");
        setMessage(response.status === 429 ? RATE_LIMIT_ERROR : REQUEST_ERROR);
      }
    } catch {
      setMessageKind("error");
      setMessage(REQUEST_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor="email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="field-input"
          id="email"
          inputMode="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </div>
      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Sending…" : "Email me a link"}
      </button>
      {message ? (
        <p
          className={messageKind === "error" ? "form-error" : "form-status"}
          role={messageKind === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
