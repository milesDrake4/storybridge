# StoryBridge closed-beta production release checklist

This is the Task 42 release record for the paid, invitation-only beta of at most
25 adults. It does not authorize an unrestricted public launch. A failed or
missing gate keeps invitations closed.

## Release record

| Field | Value |
| --- | --- |
| Release commit SHA |  |
| Production application URL |  |
| Vercel deployment ID |  |
| Supabase project ref and last migration |  |
| Release owner |  |
| Technical reviewer |  |
| Started / completed (UTC) |  |
| Previous known-good deployment |  |
| Evidence location |  |

Evidence must contain no student content, secrets, complete request/response
bodies, payment details, or authentication values. Use command summaries, safe
request/event IDs, aggregate counts, timestamps, screenshots with values
redacted, and links to protected provider dashboards.

## 1. Immutable candidate and automated gates

- [ ] Candidate is a reviewed commit on `main`; the worktree is clean and the
      exact SHA is recorded above.
- [ ] Both required GitHub checks pass on that SHA: **Quality, tests, and build**
      and **Clean database and Chromium E2E**.
- [ ] Repository rules require both checks, an up-to-date branch, and review;
      force pushes, deletion, and ordinary bypass are blocked.
- [ ] `npm run lint && npm run typecheck && npm run format:check && npm run test:coverage && npm run build` passes.
- [ ] `npx supabase test db && npm run test:e2e -- --project=chromium` passes
      against a clean migration-built local database.
- [ ] `npm audit --omit=dev --audit-level=high` has no unresolved high or
      critical production finding.
- [ ] `gitleaks git . --redact --no-banner` passes against repository history,
      and the hosting provider's secret scan reports no production credential.

Evidence: commit/check URLs, command exit summaries, dependency report, secret
scan result, reviewer/date: **____________________________________________**

## 2. Production boundaries and migration

- [ ] Preview and production use different Supabase projects, Stripe modes,
      provider credentials, HMAC secrets, and operations secrets.
- [ ] In the production secret scope,
      `DEPLOYMENT_VALIDATION_TARGET=production node scripts/validate-deployment-environment.mjs`
      passes without printing values.
- [ ] Production is `AI_PROVIDER_MODE=live`, price USD $24.99, free allowance 1,
      paid allowance 20, `BETA_ACCOUNT_CAP=25`, and monthly AI ceiling 15000 cents.
- [ ] Reviewed migrations are applied in order; the recorded migration version
      matches the candidate. No production seed contains a real student.
- [ ] Supabase security/RLS advisors contain no unresolved critical finding.
- [ ] A read-only production query finds at least 10 schools with non-null
      official domain, verification URL, verifier, and verification timestamp.
- [ ] Searching for an unsupported school returns no research authorization.

Registry query:

```sql
select count(*) as verified_school_count
from private.schools
where official_domain is not null
  and verification_source_url is not null
  and verifier_id is not null
  and verified_at is not null;
```

Evidence: environment-validation summary, migration output, advisor report,
registry count, unsupported-school result, reviewer/date:
**______________________________________________________________________**

## 3. Capacity, cost, and provider alerts

- [ ] The content-free checks in `docs/runbooks/budget-cap.md` pass.
- [ ] A production synthetic acceptance attempt beyond 25 fails closed without
      creating an accepted account. Remove only the synthetic setup rows after
      preserving aggregate evidence; never alter a real invitation.
- [ ] A production synthetic AI reservation that would cross USD $150 returns
      `AI_BUDGET_EXHAUSTED` before a provider request is created.
- [ ] OpenAI project billing alerts are enabled below and at USD $150 and were
      test-notified to the named owner.
- [ ] `AI_BUDGET_EXHAUSTED` pages and `BETA_CAP_REACHED` tickets reach the
      content-free operational destination.

Evidence: aggregate results, safe request IDs, provider alert configuration,
notification recipient, reviewer/date: **_________________________________**

## 4. Production security and public surfaces

- [ ] `curl -fsS "$NEXT_PUBLIC_APP_URL/" >/dev/null` succeeds.
- [ ] `curl -fsSI "$NEXT_PUBLIC_APP_URL/"` confirms HTTPS plus HSTS,
      `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict-origin
      referrer policy, restrictive permissions policy, and no `X-Powered-By`.
- [ ] Privacy, Terms, Responsible Use, Pricing, Support, and Account Deletion
      pages are reachable and match the approved price, processors, controls,
      retention statements, and invitation-only adult scope.
- [ ] Direct API checks reject missing/invalid invitation, under-18 consent,
      stale policy consent, cross-user access, invalid idempotency, and unsigned,
      stale, test-mode, or field-mismatched Stripe events.
- [ ] No production secret appears in browser source maps, client chunks,
      network responses, analytics, logs, or repository history.
- [ ] Application rollback to the previous deployment and invitation shutdown
      were rehearsed without touching production student data.

Evidence: header output with infrastructure identifiers redacted, policy URLs,
negative-test summary, client-bundle scan, rollback rehearsal, reviewer/date:
**______________________________________________________________________**

## 5. Synthetic journey and privacy lifecycle

Use a dedicated invited adult synthetic account and synthetic essay content.

- [ ] Magic link, current consent, interview resume, source-linked Story Vault,
      privacy controls, verified school selection, cited dossier, angles, outline,
      autosave, advice, explicit rewrite acceptance, reference-claim decisions,
      final review, and student-draft-only export all succeed.
- [ ] Private student context never appears in research requests, analytics, AI
      operation telemetry, application logs, or monitoring evidence.
- [ ] Account data export downloads successfully and contains only that account.
- [ ] Account deletion removes live profile/product/provider identity data,
      preserves only documented content-free operational records, and exposes a
      status token rather than a raw user identifier.
- [ ] The deletion synthetic account cannot authenticate after completion.

Evidence: safe request IDs, step outcomes, export/deletion timestamps, retained
record categories (not values), reviewer/date: **_________________________**

## 6. Billing and recovery

- [ ] The live purchase/refund procedure in
      `docs/runbooks/webhook-recovery.md` passes on a dedicated synthetic account.
- [ ] The USD $24.99 purchase grants the expected paid allowance exactly once.
- [ ] Full refund reverses access, late/replayed completion cannot restore it,
      and webhook records contain no essay or interview text.
- [ ] Stripe endpoint health is green; the retry queue has no unowned row older
      than ten minutes; a dashboard replay remains idempotent.
- [ ] The on-call owner can follow webhook recovery without manual entitlement
      edits or access to student content.

Evidence: redacted receipt, Stripe event IDs, terminal database states, retry
queue result, runbook reviewer/date: **____________________________________**

## 7. Monitoring and manual compatibility

- [ ] `POST /api/internal/synthetic-monitor` with the production operations
      secret returns 202; the returned `x-request-id` locates exactly one
      content-free `synthetic_monitor` event.
- [ ] No analytics/log/alert sample contains prose, URLs, query strings, user
      identifiers, HMACs, auth values, or raw provider errors.
- [ ] Full critical-journey smoke passes in current Firefox and Safari/WebKit.
- [ ] `docs/operations/accessibility-release-checklist.md` is completed,
      including keyboard-only and Safari + VoiceOver smoke. Any Windows assistive
      technology exception is explicitly risk-accepted by the owner.
- [ ] Support and incident contacts received a test notification and can access
      the budget, webhook, deletion, and rollback runbooks.

Evidence: safe monitor request ID, content audit, browser versions, completed
accessibility record, notification results, reviewer/date:
**______________________________________________________________________**

## 8. Go / no-go decision

- [ ] Every gate above has named evidence and no open critical/high security,
      privacy, payment, data-loss, integrity, or accessibility defect.
- [ ] Lower-severity exceptions list user impact, workaround, owner, and target
      date here: **_______________________________________________________**
- [ ] Previous deployment and forward-migration recovery paths remain available.
- [ ] Invitations remain disabled until the signature below.

- Decision: **GO / NO-GO**
- Owner name: **________________________**
- Owner signature or protected approval URL: **____________________________**
- Approved at (UTC): **_________________**
- Authorized maximum accepted accounts: **25**
