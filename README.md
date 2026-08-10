# StoryBridge

StoryBridge is an integrity-first college essay coaching application for an
invitation-only adult beta. It turns a structured interview into a reusable,
source-linked Story Vault, combines verified student facts with cited school
research, and keeps every AI-generated change behind explicit student review.

The application is currently a release candidate. The code and automated gates
are implemented; production provider configuration and the signed Task 42
release checklist remain required before invitations open.

## Product principles

- **Student ownership:** AI suggestions are proposals. They never silently
  overwrite the student's draft.
- **Evidence over invention:** story facts link back to interview sources, while
  school claims require excerpts from operator-verified official domains.
- **Privacy boundaries:** private student context is excluded from public web
  research, analytics, and operational logs.
- **Fail-closed limits:** PostgreSQL transactions enforce invitation, AI budget,
  essay allowance, fallback, idempotency, and payment-state constraints.
- **Integrity-safe fallback:** the single reference draft is read-only and cannot
  be accepted, copied through product controls, or exported as the submission.

## Core journey

1. An invited adult signs in by magic link and records current consent.
2. A resumable interview creates a source-linked Story Vault.
3. The student verifies facts and controls which facts AI may use.
4. The student selects a verified school and receives a cited dossier.
5. Evidence-linked angles and an editable outline guide drafting.
6. Autosave, advice, rewrites, and continuations preserve student control.
7. Final review audits the current revision and exports only student-authored
   draft text.

## Architecture

- Next.js 16, React 19, TypeScript, and Zod
- Supabase Auth and PostgreSQL with RLS, composite ownership constraints, and
  pgTAP policy/concurrency tests
- Provider-neutral AI boundary with structured output validation, moderation,
  reservations, idempotency, and content-free telemetry
- Stripe Checkout with signed raw-body webhooks, field binding, replay safety,
  reversal tombstones, and atomic entitlements
- Vitest, Testing Library, Playwright, axe-core, ESLint, and Prettier

The approved specification is in
[`docs/specs/storybridge-mvp-spec.md`](docs/specs/storybridge-mvp-spec.md), and
the implementation plan is in [`tasks/plan.md`](tasks/plan.md).

## Local development

Requirements: Node.js 24, Docker Desktop, and the Supabase CLI dependencies
installed by `npm ci`.

```bash
git clone https://github.com/milesDrake4/storybridge.git
cd storybridge
npm ci
cp .env.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

Replace only the safe local placeholders in `.env.local`. Never use production
Supabase, Stripe, or AI credentials in local development.

## Verification

```bash
npm run lint
npm run typecheck
npm run format:check
npm run test:coverage
npm run build
npx supabase test db
npm run test:e2e -- --project=chromium
```

GitHub Actions reconstructs a clean local Supabase database, runs pgTAP and the
full Chromium journey, and separately gates formatting, linting, types,
coverage, builds, deployment configuration, and production dependency audits.

## Release scope

The approved release is a paid, invitation-only beta for at most 25 adults, with
a hard USD $150 monthly AI reservation ceiling, one free essay workspace, and up
to 20 workspaces after a USD $24.99 season-pass purchase. The repository being
public does not mean production invitations are open.

Production promotion requires the named evidence and owner approval in
[`docs/release-checklist.md`](docs/release-checklist.md).

## Security and privacy

Please do not report vulnerabilities through a public issue. Until a dedicated
security contact is published, use the private contact method listed on the
deployed Support page. Do not include student content, secrets, webhook bodies,
or payment details in any report.

The policies implemented by the application are documented on the public
Privacy, Terms, Responsible Use, Support, and Account Deletion routes.
