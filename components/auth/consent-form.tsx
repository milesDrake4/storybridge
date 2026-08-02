"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { CURRENT_POLICY_VERSIONS } from "@/services/auth/eligibility";

type ConsentFormProps = {
  currentYear: number;
  onComplete?: () => void;
};

const GENERIC_ERROR = "We could not save your choices. Please try again.";
const AGE_ERROR =
  "The closed beta is currently limited to people age 18 or older.";

export function ConsentForm({ currentYear, onComplete }: ConsentFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const years = Array.from({ length: 101 }, (_, index) => currentYear - index);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/me/consent", {
        body: JSON.stringify({
          ageConfirmed: true,
          birthYear: Number(form.get("birthYear")),
          ...CURRENT_POLICY_VERSIONS,
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });

      if (response.ok) {
        if (onComplete) onComplete();
        else router.replace("/dashboard");
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const code =
        typeof body === "object" && body !== null && "error" in body
          ? (body.error as { code?: unknown } | null)?.code
          : undefined;
      setError(code === "BETA_AGE_RESTRICTED" ? AGE_ERROR : GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor="birthYear">
          Birth year
        </label>
        <select
          className="field-input"
          defaultValue=""
          id="birthYear"
          name="birthYear"
          required
        >
          <option disabled value="">
            Select your birth year
          </option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="consent-list">
        <legend className="sr-only">Required confirmations</legend>
        <label className="check-row">
          <input name="ageConfirmed" required type="checkbox" />
          <span>I confirm that I am at least 18 years old.</span>
        </label>
        <label className="check-row">
          <input name="termsAccepted" required type="checkbox" />
          <span>
            I agree to the <Link href="/terms">Terms</Link>.
          </span>
        </label>
        <label className="check-row">
          <input name="privacyAccepted" required type="checkbox" />
          <span>
            I acknowledge the <Link href="/privacy">Privacy Notice</Link>.
          </span>
        </label>
        <label className="check-row">
          <input name="responsibleUseAccepted" required type="checkbox" />
          <span>
            I agree to use StoryBridge responsibly and follow the{" "}
            <Link href="/responsible-use">Responsible Use guide</Link>.
          </span>
        </label>
      </fieldset>

      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Saving…" : "Enter StoryBridge"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
