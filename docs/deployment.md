# Deployment environments and required gates

StoryBridge uses three strictly separated environments. Production student data and production provider credentials must never be copied into local, CI, or preview systems.

## Environment boundaries

| Environment | Application | Supabase | Stripe | AI |
| --- | --- | --- | --- | --- |
| Local | Developer machine | Supabase CLI containers with synthetic fixtures | Browser/API mocks only | `AI_PROVIDER_MODE=mock` |
| CI | GitHub-hosted runner | Fresh Supabase CLI database reconstructed from migrations | Test placeholders and signed synthetic events | Recorded/unit fixtures; provider transport disabled |
| Preview | Vercel preview | Dedicated staging project containing synthetic accounts only | Dedicated test-mode keys, price, and webhook | `AI_PROVIDER_MODE=mock` by default |
| Production | Vercel production | Dedicated production project | Live-mode restricted keys and webhook | `AI_PROVIDER_MODE=live` with approved key and budget |

Preview and production Supabase project references must be different. A preview database is seeded only with synthetic fixtures; it is never restored from a production backup or populated with a real student export.

## Vercel configuration

Configure variables in the narrowest Vercel scope. Do not share one value across Preview and Production when it identifies a provider project or credential.

Preview scope:

- `VERCEL_ENV=preview` (provided by Vercel)
- `DEPLOYMENT_VALIDATION_TARGET=preview`
- `PREVIEW_SUPABASE_PROJECT_REF` matching `NEXT_PUBLIC_SUPABASE_URL`
- `PRODUCTION_SUPABASE_PROJECT_REF` for inequality validation only; a project ref is not a credential
- preview-only Supabase publishable and secret keys
- Stripe `sk_test_...`, preview price ID, and preview webhook secret
- `AI_PROVIDER_MODE=mock` and a non-provider placeholder for `OPENAI_API_KEY`
- unique preview HMAC and internal-operations secrets

Production scope:

- `VERCEL_ENV=production`
- `DEPLOYMENT_VALIDATION_TARGET=production`
- production Supabase project URL/keys and matching `PRODUCTION_SUPABASE_PROJECT_REF`
- Stripe `sk_live_...`, production price ID, and production webhook secret
- `AI_PROVIDER_MODE=live` and the approved OpenAI project key
- `BETA_ACCOUNT_CAP=25` and `MONTHLY_OPENAI_BUDGET_CENTS=15000`
- independently generated production HMAC and internal-operations secrets

## Scanner-resistant authentication email

Production and preview must not email Supabase's one-time confirmation URL
directly. Email security scanners can open that URL before the recipient and
consume it. In **Authentication > Email Templates > Magic Link**, use this
template so an automated `GET` only opens StoryBridge's confirmation page; the
Supabase verifier is reached only after the recipient explicitly submits the
confirmation form:

```html
<h2>Your StoryBridge sign-in link</h2>
<p>Open StoryBridge, then confirm that you want to sign in.</p>
<p>
  <a href="{{ .SiteURL }}/confirm-sign-in?confirmation_url={{ .ConfirmationURL }}">
    Continue to StoryBridge
  </a>
</p>
<p>This one-time link expires shortly. If you did not request it, ignore this email.</p>
```

Set the Supabase Site URL to the corresponding application origin and allow the
exact `/api/v1/auth/callback` redirect URL. Keep provider link tracking disabled.
The application validates the Supabase verification origin, path, magic-link
type, and callback destination again before issuing the user-initiated redirect.

Run `node scripts/validate-deployment-environment.mjs` in the deployment platform before a preview or production promotion. The script reports field names and policy failures only; it never prints values.

## Pull-request gates

The `Required CI` workflow runs two required jobs on every pull request and push to `main`:

1. `Quality, tests, and build`: clean dependency install, deployment-contract validation, format, lint, typecheck, coverage, production build, and a production-dependency audit.
2. `Clean database and Chromium E2E`: a new local Supabase stack, migration reset from an empty database, pgTAP policy/concurrency suite, and all Chromium E2E tests.

In the GitHub repository ruleset for `main`, require both exact check names, require the branch to be current, require one approval, block force pushes/deletion, and disallow bypass except the repository owner’s documented incident path. Workflow YAML creates the checks; the repository ruleset makes them merge-blocking.

CI uses no repository production secret. All workflow environment values are local placeholders or generated Supabase CLI credentials. Playwright screenshots, video, and traces are disabled in CI, and no report directory is uploaded, so a failed run cannot publish essay fixture text or credentials as an artifact.

## Migration and preview procedure

1. Open a pull request; do not deploy a migration manually to production.
2. Let CI reconstruct the schema with `npx supabase db reset` and run `npx supabase test db`.
3. Apply migrations to the isolated preview Supabase project using preview credentials.
4. Validate the preview environment contract.
5. Exercise public pages, authentication, privacy controls, and provider-mocked recovery behavior with synthetic accounts.
6. Review the SQL diff and CI evidence before merge.
7. Production migration and smoke execution occur only in Task 42 after owner approval.

## Deployment and rollback

Vercel previews are automatic for pull requests after environment configuration. Production promotion remains manual for the closed beta. Record the previous known-good Vercel deployment and database migration version before promotion.

Application rollback: immediately promote the previous known-good Vercel deployment. Database rollback: prefer a forward corrective migration; do not reverse a destructive migration against live data without an reviewed, rehearsed recovery plan. Disable invitations and AI reservations during any data-layer incident.

## Required external setup

- Create the isolated Supabase preview project and apply only synthetic seed data.
- Create Stripe test-mode preview price and webhook endpoint.
- Configure Vercel Preview and Production variables in separate scopes.
- Install the GitHub `main` ruleset with both CI job names required.
- Keep Vercel production deployment manual until Task 42 evidence is signed off.
