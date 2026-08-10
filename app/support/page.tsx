import Link from "next/link";

import { PolicyPage } from "@/components/marketing/public-shell";

export default function SupportPage() {
  return (
    <PolicyPage eyebrow="Invitation-only closed beta" title="Beta support">
      <p>
        Reply to your invitation email for account, billing, product, or privacy
        help. Because access is invitation-only, that email thread is the beta’s
        support channel; never include an essay, interview answer, password, or
        payment-card details in a support message.
      </p>

      <h2>Include safe diagnostic details</h2>
      <p>
        Tell us which page and action failed, the approximate time, and the
        request ID shown with the error. A request ID helps locate content-free
        operational records without asking for your essay text.
      </p>

      <h2>Self-service privacy controls</h2>
      <p>
        You do not need support to export or delete an account. Open
        <Link href="/settings"> Privacy settings</Link>. If you already deleted
        the account, use the one-time status link you saved when deletion began.
      </p>

      <h2>Payment questions</h2>
      <p>
        Include the date and Stripe receipt identifier, but not full card or
        bank information. Returning from checkout does not activate a pass by
        itself; access begins after StoryBridge verifies Stripe’s payment event.
      </p>
    </PolicyPage>
  );
}
