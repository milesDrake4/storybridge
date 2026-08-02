import Link from "next/link";

export default function ResponsibleUsePage() {
  return (
    <main className="policy-page">
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <article>
        <p className="eyebrow">Responsible use · August 2, 2026</p>
        <h1>Keep the writing yours.</h1>
        <p>
          Use StoryBridge to reflect, organize, and revise—not to generate an
          essay to submit as your own. Review every suggestion and accept only
          language that is true to your experience and voice.
        </p>
        <p>
          Never invent achievements, experiences, or school facts. Follow each
          school’s application and AI-use policies.
        </p>
      </article>
    </main>
  );
}
