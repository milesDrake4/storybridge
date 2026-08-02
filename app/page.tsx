const steps = [
  {
    number: "01",
    title: "Build your Story Vault",
    body: "Complete one guided interview, then review every experience, value, and goal before it is used.",
  },
  {
    number: "02",
    title: "Find a specific angle",
    body: "Connect your verified stories to cited opportunities at each school—not generic praise anyone could write.",
  },
  {
    number: "03",
    title: "Write in your own voice",
    body: "Start with a clear outline, draft directly, and choose whether to accept any sentence-level suggestion.",
  },
] as const;

export default function HomePage() {
  return (
    <main>
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"
        aria-label="Primary"
      >
        <a
          className="text-lg font-semibold tracking-tight text-ink"
          href="#top"
          aria-label="StoryBridge home"
        >
          StoryBridge
        </a>
        <a className="button button-secondary" href="#how-it-works">
          See how it works
        </a>
      </nav>

      <section
        id="top"
        className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:pb-28 lg:pt-24"
      >
        <div>
          <p className="eyebrow">College essays, coached—not outsourced</p>
          <h1 className="mt-5 max-w-4xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-6xl lg:text-7xl">
            Discover what only you can say.
          </h1>
          <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted sm:text-xl">
            StoryBridge turns one honest interview into school-specific
            strategy, a practical outline, and writing guidance that keeps you
            in control.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <span className="button button-primary" aria-disabled="true">
              Closed beta coming soon
            </span>
            <span className="self-center text-sm text-muted">
              First essay workspace will be free.
            </span>
          </div>
        </div>

        <aside
          className="border-l-2 border-accent pl-6 lg:mb-2"
          aria-label="Product commitment"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-strong">
            Our commitment
          </p>
          <p className="mt-4 text-xl leading-8 text-ink">
            Your experiences stay factual. School claims stay cited. AI
            suggestions never enter your draft without your choice.
          </p>
        </aside>
      </section>

      <section
        id="how-it-works"
        className="border-y border-line bg-paper-strong"
      >
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="eyebrow">A better starting point</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
              Strategy before sentences.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              The product is designed around the work a strong advisor would do
              with you, in the order that work actually helps.
            </p>
          </div>

          <ol className="mt-12 grid border-t border-line lg:grid-cols-3">
            {steps.map((step) => (
              <li
                className="border-b border-line py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0"
                key={step.number}
              >
                <span
                  className="font-mono text-sm text-accent-strong"
                  aria-hidden="true"
                >
                  {step.number}
                </span>
                <h3 className="mt-8 text-xl font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-3 leading-7 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
