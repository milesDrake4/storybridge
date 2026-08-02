import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="policy-page">
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <article>
        <p className="eyebrow">Beta terms · August 2, 2026</p>
        <h1>Terms</h1>
        <p>
          StoryBridge is a coaching tool for invited adults. You remain
          responsible for your writing, factual accuracy, and every submission.
          Do not use the service to impersonate another person or submit work
          you did not author.
        </p>
        <p>
          The beta may change or end, and features may be unavailable while we
          improve safety and reliability.
        </p>
      </article>
    </main>
  );
}
