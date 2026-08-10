import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createSupabaseAuthenticatedSession } from "@/adapters/supabase/auth";
import { toSupabaseCookieMethods } from "@/adapters/supabase/next-cookies";
import { createSupabaseProfileRepository } from "@/adapters/supabase/profile-repository";
import { parseServerConfig } from "@/lib/config/server";
import { productAccessRedirect } from "@/services/auth/access-navigation";
import { requireProductEligibility } from "@/services/auth/eligibility";

export const dynamic = "force-dynamic";

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  const config = parseServerConfig(process.env);
  const cookieMethods = toSupabaseCookieMethods(await cookies());

  try {
    await requireProductEligibility({
      profiles: createSupabaseProfileRepository(config),
      session: createSupabaseAuthenticatedSession(config, cookieMethods),
    });
  } catch (error) {
    const destination = productAccessRedirect(error);
    if (destination) redirect(destination);
    throw error;
  }

  return (
    <div className="product-shell">
      <header className="product-header">
        <Link className="wordmark" href="/dashboard">
          StoryBridge
        </Link>
        <span className="beta-badge">Closed beta</span>
      </header>
      <div className="product-grid">
        <nav className="product-nav" aria-label="Workspace">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/interview">Interview</Link>
          <Link href="/story-vault">Story Vault</Link>
          <Link href="/essays">Essays</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main className="product-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
