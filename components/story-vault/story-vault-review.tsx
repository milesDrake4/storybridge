"use client";

import { useCallback, useEffect, useState } from "react";

import { FactCard } from "@/components/story-vault/fact-card";
import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  storyFactSchema,
  storyProfileSchema,
  storyProfileWithFactsSchema,
  type StoryFact,
  type StoryProfileWithFacts,
} from "@/contracts/domain/story-vault";

type Props = { initialVault?: StoryProfileWithFacts };

function key() {
  return crypto.randomUUID();
}
function factEtag(fact: StoryFact) {
  return `"fact:${fact.id}:r${fact.revision}"`;
}
async function json(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function StoryVaultReview({ initialVault }: Props) {
  const [vault, setVault] = useState(initialVault ?? null);
  const [loading, setLoading] = useState(!initialVault);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [excludedTopics, setExcludedTopics] = useState(
    initialVault?.profile.excludedTopics.join(", ") ?? "",
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/story-profile", {
        cache: "no-store",
      });
      const parsed = apiSuccessSchema(storyProfileWithFactsSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setVault(parsed.data.data);
      setExcludedTopics(parsed.data.data.profile.excludedTopics.join(", "));
    } catch {
      setNotice("We could not load your Story Vault. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialVault) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialVault, load]);

  async function mutateFact(fact: StoryFact, path: string, init: RequestInit) {
    setBusyId(fact.id);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/story-facts/${fact.id}${path}`,
        init,
      );
      const parsed = apiSuccessSchema(storyFactSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setVault((current) =>
        current
          ? {
              ...current,
              facts: current.facts.map((item) =>
                item.id === fact.id ? { ...item, ...parsed.data.data } : item,
              ),
            }
          : current,
      );
      setNotice("Changes saved.");
      return true;
    } catch {
      setNotice("That change could not be saved. Reload and try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  if (loading)
    return (
      <section aria-busy="true">
        <h1>Loading your Story Vault…</h1>
      </section>
    );
  if (!vault)
    return (
      <section>
        <h1>Your Story Vault is not ready yet.</h1>
      </section>
    );

  return (
    <section className="story-vault" aria-labelledby="story-vault-heading">
      <header className="story-vault-intro">
        <p className="eyebrow">Private evidence library</p>
        <h1 id="story-vault-heading">
          Review what we heard—not what we guessed.
        </h1>
        <p>
          Every item starts unverified. Open its interview source, edit the
          wording, then verify or reject it yourself.
        </p>
      </header>
      {notice ? (
        <p className="vault-notice" role="status">
          {notice}
        </p>
      ) : null}

      <form
        className="excluded-topics"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusyId("profile");
          try {
            const response = await fetch("/api/v1/story-profile", {
              body: JSON.stringify({
                excludedTopics: excludedTopics
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              }),
              headers: {
                "content-type": "application/json",
                "if-match": `"profile:${vault.profile.id}:r${vault.profile.revision}"`,
              },
              method: "PATCH",
            });
            const parsed = apiSuccessSchema(storyProfileSchema).safeParse(
              await json(response),
            );
            if (!response.ok || !parsed.success) throw new Error();
            setVault({ ...vault, profile: parsed.data.data });
            setNotice("Privacy preferences saved.");
          } catch {
            setNotice("Privacy preferences could not be saved.");
          } finally {
            setBusyId(null);
          }
        }}
      >
        <label className="field-label" htmlFor="excluded-topics">
          Topics to keep out of AI assistance
        </label>
        <p id="excluded-help">
          Separate topics with commas. These preferences stay under your
          control.
        </p>
        <textarea
          id="excluded-topics"
          aria-describedby="excluded-help"
          disabled={busyId === "profile"}
          onChange={(event) => setExcludedTopics(event.target.value)}
          rows={3}
          value={excludedTopics}
        />
        <button
          className="button button-secondary"
          disabled={busyId === "profile"}
          type="submit"
        >
          Save privacy preferences
        </button>
      </form>

      <div className="fact-list">
        {vault.facts.map((fact) => (
          <FactCard
            busy={busyId === fact.id}
            fact={fact}
            key={fact.id}
            onDelete={async () => {
              setBusyId(fact.id);
              try {
                const response = await fetch(`/api/v1/story-facts/${fact.id}`, {
                  headers: { "idempotency-key": key() },
                  method: "DELETE",
                });
                if (!response.ok) throw new Error();
                setVault((current) =>
                  current
                    ? {
                        ...current,
                        facts: current.facts.filter(
                          (item) => item.id !== fact.id,
                        ),
                      }
                    : current,
                );
                setNotice("Fact deleted.");
              } catch {
                setNotice("The fact could not be deleted.");
              } finally {
                setBusyId(null);
              }
            }}
            onEdit={(summary, details) =>
              mutateFact(fact, "", {
                body: JSON.stringify({ details, summary }),
                headers: {
                  "content-type": "application/json",
                  "if-match": factEtag(fact),
                },
                method: "PATCH",
              })
            }
            onSuppress={async (suppressed) => {
              await mutateFact(fact, "/suppression", {
                body: JSON.stringify({ suppressed }),
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": key(),
                },
                method: "PUT",
              });
            }}
            onVerify={async (decision) => {
              await mutateFact(fact, "/verification", {
                body: JSON.stringify({
                  contentHash: fact.contentHmac,
                  decision,
                  expectedRevision: fact.revision,
                }),
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": key(),
                  "if-match": factEtag(fact),
                },
                method: "POST",
              });
            }}
          />
        ))}
      </div>
    </section>
  );
}
