import Link from "next/link";
import type { ReactNode } from "react";

const primaryLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/responsible-use", label: "Responsible Use" },
  { href: "/support", label: "Support" },
] as const;

const policyLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/responsible-use", label: "Responsible Use" },
  { href: "/account-deletion", label: "Account deletion" },
  { href: "/support", label: "Support" },
] as const;

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link className="wordmark" href="/" aria-label="StoryBridge home">
          StoryBridge
        </Link>
        <nav aria-label="Primary">
          {primaryLinks.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
      <footer className="public-footer">
        <div>
          <Link className="wordmark" href="/">
            StoryBridge
          </Link>
          <p>College essay coaching for invited adults.</p>
        </div>
        <nav aria-label="Policies and support">
          {policyLinks.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}

export function PolicyPage({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <PublicShell>
      <main className="policy-page">
        <article>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {children}
        </article>
      </main>
    </PublicShell>
  );
}
