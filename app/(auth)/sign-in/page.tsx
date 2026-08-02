import Link from "next/link";

import { AccessForm } from "@/components/auth/access-form";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;

  return (
    <main className="auth-page">
      <Link className="wordmark" href="/">
        StoryBridge
      </Link>
      <section className="auth-panel" aria-labelledby="sign-in-heading">
        <p className="eyebrow">Invitation-only beta</p>
        <h1 id="sign-in-heading">Sign in with a secure email link.</h1>
        <p className="auth-intro">
          Enter the email address that received your invitation. We’ll send a
          one-time link—no password needed.
        </p>
        <AccessForm
          initialError={singleValue(query.error)}
          inviteToken={singleValue(query.invite)}
        />
        <p className="auth-footnote">
          StoryBridge is currently available only to invited applicants age 18
          or older.
        </p>
      </section>
    </main>
  );
}
