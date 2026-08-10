import Link from "next/link";

import { PolicyPage } from "@/components/marketing/public-shell";

export default function TermsPage() {
  return (
    <PolicyPage eyebrow="Beta terms · August 10, 2026" title="Terms">
      <p>
        StoryBridge is a closed-beta college essay coaching service for invited
        adults who attest that they are at least 18. Invitations are personal
        and may be revoked. You must provide accurate account information and
        keep access to your email account secure.
      </p>

      <h2>Your work and responsibility</h2>
      <p>
        You remain responsible for your writing, factual accuracy, school-policy
        compliance, and every application submission. StoryBridge is not legal,
        admissions, or financial advice. There is no promise of admission,
        scholarship, or any other application outcome.
      </p>
      <p>
        Do not impersonate another person, invent credentials, misuse another
        person’s information, or submit AI output as your own work. The
        <Link href="/responsible-use"> Responsible Use Policy</Link> is part of
        these terms.
      </p>

      <h2>Beta availability</h2>
      <p>
        The beta may change, pause, or end while reliability and safety are
        improved. The service may block an export when required evidence, prompt
        coverage, word limits, or authorship safeguards are not met. StoryBridge
        does not submit an application on your behalf.
      </p>

      <h2>Payment and access</h2>
      <p>
        The free allowance covers one essay workspace for the season. A season
        pass is a one-time payment for up to 20 workspaces in the 2026–2027
        season. Access begins only after a verified Stripe payment event. A
        refund or dispute ends the paid entitlement. See{" "}
        <Link href="/pricing">Pricing</Link> for the current configured price.
      </p>

      <h2>Ending your account</h2>
      <p>
        You may export or delete your account without support intervention.
        Deletion immediately ends product access and follows the process
        described on the <Link href="/account-deletion">Account deletion</Link>{" "}
        page.
      </p>
    </PolicyPage>
  );
}
