import { PolicyPage } from "@/components/marketing/public-shell";

export default function ResponsibleUsePage() {
  return (
    <PolicyPage
      eyebrow="Responsible use · August 10, 2026"
      title="Keep the writing yours."
    >
      <p>
        Use StoryBridge to reflect, organize, and revise—not to outsource an
        application essay. Review every proposal and accept only language that
        is true to your experience and voice.
      </p>

      <h2>Reference drafts are a last-resort learning aid</h2>
      <p>
        Each essay can receive one read-only reference draft only after the
        required coaching steps. It is shown separately, requires factual claim
        decisions, and cannot be accepted or exported by StoryBridge. You must
        substantially revise rather than copy it. Similarity and evidence checks
        can block export of the editable student draft.
      </p>

      <h2>Accuracy is required</h2>
      <p>
        Never invent achievements, experiences, identities, credentials, or
        school facts. Verify that each statement remains accurate and remove a
        rejected reference-draft claim from your student draft before export.
      </p>

      <h2>School rules still govern</h2>
      <p>
        Follow each school’s application and AI-use policies. StoryBridge’s
        safeguards reduce risk but cannot determine authorship or guarantee that
        a school will permit a particular use of AI assistance.
      </p>

      <h2>Keep sensitive data out</h2>
      <p>
        Do not paste an existing essay, private notes, contact details,
        passwords, government identifiers, or unnecessary sensitive records into
        a supplemental prompt field. Do not use the service to harm, threaten,
        exploit, or impersonate anyone.
      </p>
    </PolicyPage>
  );
}
