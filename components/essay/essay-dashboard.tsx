"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import { essayPageSchema, type EssaySummary } from "@/contracts/http/v1/essays";
import type { Page } from "@/contracts/http/v1/common";
import { SeasonPassPanel } from "@/components/billing/season-pass-panel";

type Props = {
  initialPage?: Page<EssaySummary>;
  seasonPassPriceCents?: number;
};

async function responseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function EssayDashboard({
  initialPage,
  seasonPassPriceCents = 2_499,
}: Props) {
  const [items, setItems] = useState(initialPage?.items ?? []);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  const [loading, setLoading] = useState(initialPage === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setNotice(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/essays?${params}`, {
        cache: "no-store",
      });
      const parsed = apiSuccessSchema(essayPageSchema).safeParse(
        await responseJson(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      setItems((current) =>
        cursor
          ? [...current, ...parsed.data.data.items]
          : parsed.data.data.items,
      );
      setNextCursor(parsed.data.data.nextCursor);
    } catch {
      setNotice(
        "We could not load your essays. Your work is still safe; try again.",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (initialPage !== undefined) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialPage, load]);

  if (loading) {
    return (
      <section
        className="essay-dashboard"
        aria-busy="true"
        aria-label="Loading essays"
      >
        <p className="eyebrow">Essay workspace</p>
        <h1>Loading your essays…</h1>
        <div className="essay-list-skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      </section>
    );
  }

  return (
    <section className="essay-dashboard" aria-labelledby="essays-heading">
      <header className="essay-page-header">
        <div>
          <p className="eyebrow">Essay workspace</p>
          <h1 id="essays-heading">Your essays</h1>
          <p>
            Choose a school prompt, develop your strategy, and keep every draft
            under your control.
          </p>
        </div>
        <Link className="button button-primary" href="/essays/new">
          Set up an essay
        </Link>
      </header>

      <SeasonPassPanel priceCents={seasonPassPriceCents} />

      {notice ? (
        <div className="essay-notice" role="alert">
          <p>{notice}</p>
          <button
            className="button button-secondary"
            onClick={() => void load()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {!notice && items.length === 0 ? (
        <div className="essay-empty">
          <p className="essay-step" aria-hidden="true">
            01
          </p>
          <h2>No essays yet</h2>
          <p>
            Start with an official application prompt. You will never be asked
            to confirm a school domain.
          </p>
          <Link className="button button-primary" href="/essays/new">
            Set up your first essay
          </Link>
        </div>
      ) : (
        <ul className="essay-list" aria-label="Your essays">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <p className="essay-status">
                  {item.status.toLocaleLowerCase("en-US")}
                </p>
                <h2>{item.school.canonicalName}</h2>
                <p>
                  {item.wordLimit} words · Updated{" "}
                  {new Date(item.updatedAt).toLocaleDateString("en-US")}
                </p>
              </div>
              <Link
                className="button button-secondary"
                href={`/essays/${item.id}`}
              >
                Open essay
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <button
          className="button button-secondary essay-load-more"
          disabled={loadingMore}
          onClick={() => void load(nextCursor)}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load more essays"}
        </button>
      ) : null}
    </section>
  );
}
