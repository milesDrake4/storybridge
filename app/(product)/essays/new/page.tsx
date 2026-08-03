import { EssaySetupForm } from "@/components/essay/essay-setup-form";

export default function NewEssayPage() {
  return (
    <section className="essay-setup" aria-labelledby="essay-setup-heading">
      <header className="essay-page-header">
        <div>
          <p className="eyebrow">New essay</p>
          <h1 id="essay-setup-heading">Set up the prompt—not your answer.</h1>
          <p>
            Choose a verified school and paste its official question. Personal
            notes and draft writing stay out of this step.
          </p>
        </div>
      </header>
      <EssaySetupForm />
    </section>
  );
}
