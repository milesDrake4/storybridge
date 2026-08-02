# StoryBridge

## Problem Statement

How might we give financially constrained college applicants personalized, private-advisor-quality essay coaching while preserving their truth, voice, and ownership?

## Recommended Direction

Build an iOS essay coach centered on one persistent Student Story Vault. The student completes one deep interview about their experiences, values, interests, goals, and writing voice.

For each supplemental prompt, the app researches the school, identifies meaningful student-school connections, proposes essay angles, helps construct an outline, and coaches the student while they write. Full-draft generation exists only as a clearly labeled fallback.

The product promise is: **We help you discover what only you can say—and express it convincingly to this particular school.**

## Key Assumptions to Validate

- [ ] Students will complete a 10–15 minute interview before receiving value.
- [ ] One interview captures enough context for several essays.
- [ ] Three personalized angles are more valuable than immediate generation.
- [ ] Students will pay instead of using general-purpose AI.
- [ ] Coaching can preserve voice across revisions.
- [ ] Students will use full generation as a fallback rather than the default.
- [ ] School research can remain accurate, current, and attributable to official sources.

## MVP Scope

- One conversational interview creates an editable Student Story Vault.
- Students enter a college and paste a supplemental essay prompt.
- The app researches official school sources and shows citations.
- The app proposes three personalized essay angles.
- The student chooses an angle and builds a guided outline.
- A focused editor offers contextual coaching, sentence generation, snippet rewriting, and feedback.
- Full-draft generation is available only as a labeled fallback after strategy and outlining.
- Students confirm factual claims before exporting plain text.
- The app supports a free first essay and paid access to additional essays.

## Not Doing (and Why)

- **Common App personal statement** — supplemental essays are the initial wedge.
- **College-list recommendations** — part of the long-term advisor, not this MVP.
- **Admissions predictions or guarantees** — unreliable and outside product control.
- **Automatic Common App import** — unnecessary integration risk.
- **Complete prompt database** — expensive to maintain accurately.
- **Repeated interviews for every school** — undermines the Story Vault advantage.
- **Separate coach/generator modes** — one workflow with progressively stronger assistance.
- **Human advisor marketplace** — operationally incompatible with a one-week launch.
- **Android or web clients** — focus the initial release on iOS.

## Open Questions

- Which native and backend technologies should the one-week build use?
- Which model and research mechanism best balance quality, latency, and cost?
- What paid entitlement and price should the beta test?
- What minimum age, consent, retention, and deletion policies are required?
- How should AI-generated passages be visibly identified and tracked?

