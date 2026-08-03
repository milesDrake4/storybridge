# Browser verification

The Playwright specifications for invited access and the interview are
committed, but this Codex macOS sandbox cannot launch Chromium. The browser
process exits before page creation with:

```text
MachPortRendezvousServer: Permission denied (1100)
```

Run these checks in an unrestricted macOS shell or CI environment:

```sh
npm run test:e2e -- --project=chromium e2e/invited-access.spec.ts
E2E_AUTH_STORAGE_STATE=/absolute/path/to/invited-adult-storage-state.json \
  npm run test:e2e -- --project=chromium e2e/interview.spec.ts
E2E_AUTH_STORAGE_STATE=/absolute/path/to/invited-adult-storage-state.json \
  npm run test:e2e -- --project=chromium e2e/story-vault.spec.ts
```

The interview and Story Vault storage state must contain a current authenticated
Supabase user whose invitation, adult profile, and policy consent are valid in
the target test environment. Their client API calls are synthetic and
intercepted by the specifications; the session is needed only for the
server-rendered product access gate.
