import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { AccountPrivacyPanel } from "@/components/privacy/account-privacy-panel";
import { parseServerConfig } from "@/lib/config/server";
import {
  EligibilityError,
  requirePrivacyAccess,
} from "@/services/auth/eligibility";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const config = parseServerConfig(process.env);
  try {
    await requirePrivacyAccess(
      createSupabaseAuthenticatedSession(
        config,
        toSupabaseCookieMethods(await cookies()),
      ),
    );
  } catch (error) {
    if (error instanceof EligibilityError) redirect("/sign-in?next=/settings");
    throw error;
  }

  return (
    <div className="privacy-shell">
      <header className="product-header">
        <Link className="wordmark" href="/dashboard">
          StoryBridge
        </Link>
        <span className="beta-badge">Account settings</span>
      </header>
      <main className="privacy-main">
        <p className="eyebrow">Privacy controls</p>
        <h1>Keep your data in your hands.</h1>
        <p className="privacy-intro">
          Download a private JSON copy of your StoryBridge application data or
          permanently delete your account. These controls stay available even if
          your beta or paid access changes.
        </p>
        <AccountPrivacyPanel />
      </main>
    </div>
  );
}
