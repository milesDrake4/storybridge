import Link from "next/link";

import { PublicShell } from "@/components/marketing/public-shell";
import { getPublicProductFacts } from "@/lib/marketing/product-facts";

export default function PricingPage() {
  const facts = getPublicProductFacts();
  return (
    <PublicShell>
      <main className="public-page">
        <header className="public-page-heading">
          <p className="eyebrow">2026–2027 application season</p>
          <h1>Simple beta pricing.</h1>
          <p>
            Start with one workspace. Pay once only if you need room for more
            supplemental essays during this application season.
          </p>
        </header>
        <section className="pricing-grid" aria-label="Beta plans">
          <article>
            <p className="eyebrow">Free</p>
            <p className="pricing-price">$0</p>
            <h2>One essay workspace</h2>
            <ul>
              <li>Guided interview and reviewed Story Vault</li>
              <li>Cited school research and essay strategy</li>
              <li>Outlining, revision proposals, and final export checks</li>
              <li>One read-only reference draft for that essay</li>
            </ul>
            <p className="pricing-note">
              Deleting the workspace does not restore the free allowance.
            </p>
          </article>
          <article className="pricing-featured">
            <p className="eyebrow">Season pass</p>
            <p className="pricing-price">{facts.price}</p>
            <h2>Up to {facts.paidEssayLimit} essay workspaces</h2>
            <ul>
              <li>Everything in the free workspace</li>
              <li>One-time payment for the {facts.season} season</li>
              <li>Stripe-hosted checkout</li>
              <li>Access begins only after verified payment confirmation</li>
            </ul>
            <Link className="button button-primary" href="/sign-in">
              Sign in to continue
            </Link>
          </article>
        </section>
        <p className="public-disclaimer">
          StoryBridge provides coaching tools and does not guarantee admission
          or any application outcome. Refunds and disputes revoke paid access;
          applicable consumer rights still apply.
        </p>
      </main>
    </PublicShell>
  );
}
