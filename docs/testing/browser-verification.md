# Browser verification

The Playwright specifications for invited access and the interview are
committed, but this Codex macOS sandbox cannot launch Chromium. The browser
process exits before page creation with:

```text
MachPortRendezvousServer: Permission denied (1100)
```

Run these checks in an unrestricted macOS shell or CI environment:

```sh
npx supabase start
npm run test:e2e -- --project=chromium e2e/invited-access.spec.ts
npm run test:e2e -- --project=chromium e2e/interview.spec.ts
npm run test:e2e -- --project=chromium e2e/story-vault.spec.ts
```

The interview and Story Vault checks create a random, disposable invited-adult
user in local Supabase, write a mode-`0600` Playwright storage state under the
ignored `test-results/` directory, and remove both after the specification.
Their client API calls remain synthetic and intercepted; local Supabase is used
only to exercise the real server-rendered authentication and eligibility gate.

To use an existing hosted test session instead, set `E2E_AUTH_STORAGE_STATE`,
`E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, and
`E2E_SUPABASE_SECRET_KEY`. Never point automatic disposable-user provisioning
at a non-loopback Supabase URL.
