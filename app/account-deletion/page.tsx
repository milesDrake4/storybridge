import Link from "next/link";

import { PolicyPage } from "@/components/marketing/public-shell";

export default function AccountDeletionPage() {
  return (
    <PolicyPage eyebrow="Self-service privacy control" title="Account deletion">
      <p>
        Account deletion is permanent. Starting it immediately signs you out and
        blocks existing sessions from using product APIs. You do not need an
        active invitation, current policy acceptance, or paid entitlement to use
        the deletion control.
      </p>

      <h2>What is removed</h2>
      <p>
        StoryBridge deletes live profile, interview, Story Vault, essay,
        research-linkage, proposal, export, entitlement-linkage, and linkable
        operational records, then deletes the Supabase authentication identity.
        Legally required payment records may remain at Stripe without essay
        content.
      </p>

      <h2>How status works</h2>
      <p>
        The confirmation shows a one-time status token. Save it before leaving
        the page; StoryBridge stores only its keyed fingerprint and cannot show
        the token again. The token returns deletion status without profile
        content and expires 30 days after completion.
      </p>

      <h2>Provider backups</h2>
      <p>
        Encrypted residual copies may remain in service-provider backups until
        normal backup rotation completes. They are not available in the live
        StoryBridge product and are not restored as an active account.
      </p>

      <Link className="button button-danger" href="/settings">
        Open Privacy settings
      </Link>
    </PolicyPage>
  );
}
