import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <article>
        <p className="eyebrow">Beta notice · August 2, 2026</p>
        <h1>Privacy Notice</h1>
        <p>
          StoryBridge uses the information you choose to provide to operate your
          private coaching workspace. We do not sell your personal information
          or use your essay content for advertising.
        </p>
        <p>
          Keep highly sensitive information out of prompts. Account export and
          deletion controls will be available before the beta opens.
        </p>
      </article>
    </main>
  );
}
