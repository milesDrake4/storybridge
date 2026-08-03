"use client";

import { useEffect, useMemo, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  schoolPageSchema,
  schoolRequestSchema,
  type SchoolSummary,
} from "@/contracts/http/v1/schools";

type Props = {
  initialSchools?: SchoolSummary[];
  onSelect(school: SchoolSummary): void;
  value: SchoolSummary | null;
};

async function json(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function requestKey() {
  return crypto.randomUUID();
}

export function SchoolPicker({ initialSchools, onSelect, value }: Props) {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState(initialSchools ?? []);
  const [loading, setLoading] = useState(initialSchools === undefined);
  const [searchError, setSearchError] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestState, setRequestState] = useState<
    "ERROR" | "IDLE" | "SENDING" | "SENT"
  >("IDLE");

  useEffect(() => {
    if (initialSchools !== undefined) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const params = new URLSearchParams({ limit: "10", query });
        const response = await fetch(`/api/v1/schools?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const parsed = apiSuccessSchema(schoolPageSchema).safeParse(
          await json(response),
        );
        if (!response.ok || !parsed.success) throw new Error();
        setSchools(parsed.data.data.items);
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [initialSchools, query]);

  const visibleSchools = useMemo(() => {
    if (initialSchools === undefined || !query.trim()) return schools;
    const needle = query.normalize("NFKC").toLocaleLowerCase("en-US");
    return schools.filter((school) =>
      school.canonicalName
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .includes(needle),
    );
  }, [initialSchools, query, schools]);

  async function submitRequest() {
    const name = requestName.trim();
    if (!name) {
      setRequestState("ERROR");
      return;
    }
    setRequestState("SENDING");
    try {
      const response = await fetch("/api/v1/school-requests", {
        body: JSON.stringify({ name }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestKey(),
        },
        method: "POST",
      });
      const parsed = apiSuccessSchema(schoolRequestSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setRequestState("SENT");
    } catch {
      setRequestState("ERROR");
    }
  }

  return (
    <fieldset className="school-picker">
      <legend>Choose a supported school</legend>
      <p id="school-picker-help">
        Search the verified registry by school name. StoryBridge controls the
        official domain.
      </p>
      <label className="field-label" htmlFor="school-search">
        Search schools
      </label>
      <input
        aria-describedby="school-picker-help"
        autoComplete="off"
        className="field-input"
        id="school-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Start typing a school name"
        type="search"
        value={query}
      />

      {loading ? <p role="status">Searching verified schools…</p> : null}
      {searchError ? (
        <p role="alert">
          School search is unavailable. Try again without re-entering your
          prompt.
        </p>
      ) : null}
      {!loading && !searchError ? (
        <ul className="school-results" aria-label="School results">
          {visibleSchools.map((school) => (
            <li key={school.id}>
              <button
                aria-pressed={value?.id === school.id}
                onClick={() => onSelect(school)}
                type="button"
              >
                <span>{school.canonicalName}</span>
                <span aria-hidden="true">
                  {value?.id === school.id ? "Selected" : "Choose"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="school-request">
        <p>School not listed?</p>
        <button
          className="button button-secondary"
          onClick={() => setRequestOpen((open) => !open)}
          type="button"
        >
          Request a school
        </button>
        {requestOpen ? (
          <div className="school-request-panel">
            <label className="field-label" htmlFor="school-request-name">
              School name
            </label>
            <input
              className="field-input"
              disabled={requestState === "SENDING" || requestState === "SENT"}
              id="school-request-name"
              maxLength={200}
              onChange={(event) => {
                setRequestName(event.target.value);
                if (requestState === "ERROR") setRequestState("IDLE");
              }}
              required
              value={requestName}
            />
            <button
              className="button button-secondary"
              disabled={requestState === "SENDING" || requestState === "SENT"}
              onClick={() => void submitRequest()}
              type="button"
            >
              {requestState === "SENDING" ? "Sending…" : "Send request"}
            </button>
            {requestState === "SENT" ? (
              <p role="status">
                Request received. We will verify the school before it can be
                selected.
              </p>
            ) : null}
            {requestState === "ERROR" ? (
              <p role="alert">
                The request was not sent. Your school name is still here; try
                again.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
