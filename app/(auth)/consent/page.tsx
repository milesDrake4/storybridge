import Link from "next/link";

import { ConsentForm } from "@/components/auth/consent-form";

export default function ConsentPage() {
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <section
        className="auth-panel auth-panel-wide"
        aria-labelledby="consent-heading"
      >
        <p className="eyebrow">Before you begin</p>
        <h1 id="consent-heading">A clear agreement, in plain language.</h1>
        <p className="auth-intro">
          You own your experiences and your writing. StoryBridge helps you find
          structure and gives suggestions; it does not write or submit an essay
          for you.
        </p>
        <ConsentForm currentYear={new Date().getUTCFullYear()} />
      </section>
    </main>
  );
}
