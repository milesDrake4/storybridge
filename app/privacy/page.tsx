import Link from "next/link";

import { PolicyPage } from "@/components/marketing/public-shell";

export default function PrivacyPage() {
  return (
    <PolicyPage eyebrow="Effective August 10, 2026" title="Privacy Notice">
      <p>
        StoryBridge uses the account, interview, Story Vault, school, prompt,
        draft, and coaching information you choose to provide to operate your
        private workspace. We do not sell personal information or use essay
        content for advertising.
      </p>

      <h2>Who can use the beta</h2>
      <p>
        This closed beta is invitation-only. It is limited to people who attest
        that they are at least 18. StoryBridge has not completed the separate
        consent and privacy work required to admit minors.
      </p>

      <h2>Service providers</h2>
      <ul>
        <li>
          <strong>Vercel</strong> hosts the Next.js application and processes
          web requests.
        </li>
        <li>
          <strong>Supabase</strong> provides authentication and the application
          database.
        </li>
        <li>
          <strong>OpenAI</strong> provides moderation, coaching models, and
          domain-restricted public school research. Generation requests use
          <code> store: false</code>.
        </li>
        <li>
          <strong>Stripe</strong> hosts checkout and processes payment records.
          StoryBridge does not receive full card details.
        </li>
      </ul>
      <p>
        Private student context is not sent to web search. School research uses
        only a server-owned research rubric and a verified school domain.
        Content-free operational records may contain purpose, model, token,
        cost, latency, status, and request identifiers, but not raw essays or
        interview answers.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>Rotating keyed IP fingerprints expire within 24 hours.</li>
        <li>
          AI request and response keyed fingerprints expire after 30 days.
        </li>
        <li>Rejected or expired AI proposals are retained for 90 days.</li>
        <li>
          Inactive application accounts are scheduled for deletion after 18
          months, following notices 30 days and 7 days beforehand.
        </li>
      </ul>
      <p>
        Deleting an account removes live application content and linkable
        operational metadata. Service-provider backups may retain encrypted
        residual copies until each provider’s normal backup rotation completes;
        those copies are not available through StoryBridge. Legally required
        payment records may remain with Stripe without essay content.
      </p>

      <h2>Your controls</h2>
      <p>
        Signed-in users can export their StoryBridge application data or delete
        their account in <Link href="/settings">Privacy settings</Link>. Export
        excludes internal fraud and rate-limit secrets and other users’ data.
        Read the public{" "}
        <Link href="/account-deletion">deletion explanation</Link> before
        deleting.
      </p>
      <p>
        Keep passwords, government identifiers, medical records, and other
        unnecessary highly sensitive information out of prompts and drafts. For
        privacy help, visit <Link href="/support">Support</Link>.
      </p>
    </PolicyPage>
  );
}
