import Link from "next/link";

import { parseServerConfig } from "@/lib/config/server";
import { parseSupabaseConfirmationUrl } from "@/lib/security/supabase-confirmation-url";

type ConfirmSignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function ConfirmSignInPage({
  searchParams,
}: ConfirmSignInPageProps) {
  const config = parseServerConfig(process.env);
  const query = await searchParams;
  const rawConfirmationUrl = singleValue(query.confirmation_url);
  const confirmationUrl = rawConfirmationUrl
    ? parseSupabaseConfirmationUrl(rawConfirmationUrl, {
        appUrl: config.appUrl,
        redirectTo: singleValue(query.redirect_to),
        supabaseUrl: config.supabaseUrl,
        type: singleValue(query.type),
      })
    : null;

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <section className="auth-panel" aria-labelledby="confirmation-heading">
        <p className="eyebrow">Secure sign in</p>
        <h1 id="confirmation-heading">Confirm it’s really you.</h1>
        {confirmationUrl ? (
          <>
            <p className="auth-intro">
              Your email link is valid. Confirm below to use this one-time link
              and finish signing in.
            </p>
            <form
              action="/api/v1/auth/confirm"
              className="auth-form"
              method="post"
            >
              <input
                name="confirmationUrl"
                type="hidden"
                value={confirmationUrl.href}
              />
              <button className="button button-primary" type="submit">
                Confirm sign in
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="auth-intro" role="alert">
              This sign-in link is incomplete or no longer valid. Request a new
              link and use only the newest email.
            </p>
            <p className="auth-form">
              <Link className="button button-primary" href="/sign-in">
                Request a new link
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
