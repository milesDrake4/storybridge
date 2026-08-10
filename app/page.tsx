import Link from "next/link";

import { PublicShell } from "@/components/marketing/public-shell";

const steps = [
  {
    number: "01",
    title: "Build your Story Vault",
    body: "Complete one guided interview, then review every experience, value, and goal before it can support coaching.",
  },
  {
    number: "02",
    title: "Find a specific angle",
    body: "Connect your verified stories to cited opportunities on an operator-verified school domain.",
  },
  {
    number: "03",
    title: "Write in your own voice",
    body: "Start from an outline, draft directly, and decide whether to accept each sentence-level proposal.",
  },
] as const;

export default function HomePage() {
  return (
    <PublicShell>
      <main>
        <section className="public-hero" id="top">
          <div>
            <p className="eyebrow">College essays, coached—not outsourced</p>
            <h1>Discover what only you can say.</h1>
            <p className="public-lede">
              StoryBridge turns one honest interview into school-specific
              strategy, a practical outline, and writing guidance that keeps you
              in control.
            </p>
            <div className="public-actions">
              <Link className="button button-primary" href="/sign-in">
                Invited? Sign in
              </Link>
              <Link className="button button-secondary" href="/pricing">
                View beta pricing
              </Link>
            </div>
            <p className="beta-boundary">
              Invitation-only closed beta for US applicants who attest they are
              18 or older. Enrollment is capped at 25 accepted accounts.
            </p>
          </div>
          <aside aria-label="Product commitment">
            <p className="eyebrow">Our commitment</p>
            <p>
              Your experiences stay factual. School claims stay cited. AI
              suggestions never enter your draft without your choice.
            </p>
          </aside>
        </section>

        <section className="public-band" id="how-it-works">
          <div className="public-section">
            <div className="public-section-heading">
              <p className="eyebrow">A better starting point</p>
              <h2>Strategy before sentences.</h2>
              <p>
                The product follows the work a thoughtful advisor would do with
                you, while preserving your authorship and responsibility.
              </p>
            </div>
            <ol className="public-steps">
              {steps.map((step) => (
                <li key={step.number}>
                  <span aria-hidden="true">{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="public-section public-integrity">
          <div>
            <p className="eyebrow">A boundary, not a shortcut</p>
            <h2>Coaching deliverables. No admission promises.</h2>
          </div>
          <div>
            <p>
              StoryBridge can help you organize evidence, explore an angle,
              shape an outline, and review a draft. It does not predict or
              guarantee admission, and it does not submit applications.
            </p>
            <p>
              If you use the one read-only AI reference draft available for an
              essay, you must make meaningful revisions. It cannot be accepted
              into or exported from your student draft.
            </p>
            <Link href="/responsible-use">Read the Responsible Use Policy</Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
