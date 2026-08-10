# StoryBridge observability and alert runbooks

## On-call questions

1. Which allowlisted product step is failing or dropping off?
2. Are AI cost, latency, refusal, or budget limits degrading students?
3. Is the 25-account beta cap blocking expected invitations?
4. Are Stripe correlation failures waiting for retry?

Product analytics answer the first question using fixed event names and numeric or
enumerated properties. The private AI operation ledger and the
`ai_provider_operation` schema answer the second with purpose, model, token,
cost, latency, and status only. Structured request errors and operator alerts
answer the remaining questions by request ID without user content.

Free text, request bodies, source URLs, query strings, user identifiers, raw
provider errors, authentication values, and HMACs are prohibited from all
analytics and logs.

## Operator alerts

### AI_BUDGET_EXHAUSTED — page

- Meaning: the global monthly reservation ceiling is denying AI operations.
- First check: inspect the monthly reserved/final cost totals and provider
  billing dashboard; do not inspect student content.
- Escalation: keep the ceiling closed and contact the launch owner before any
  budget change.

### BETA_CAP_REACHED — ticket

- Meaning: the accepted-account cap is preventing another beta acceptance.
- First check: compare the private cohort counter with accepted invitations.
- Escalation: reconcile inconsistent rows; do not raise the limit beyond 25
  during the approved beta.

### WEBHOOK_RETRY_PENDING — ticket

- Meaning: a Stripe event could not yet be correlated or retrieved and returned
  HTTP 500 so Stripe will retry.
- First check: query retry-pending Stripe rows by safe status and age, then use
  the request ID in structured logs.
- Escalation: investigate if the oldest retry exceeds ten minutes; never paste
  webhook bodies into logs or tickets.

## Synthetic error-pipeline check

`POST /api/internal/synthetic-monitor` with
`Authorization: Bearer $INTERNAL_OPERATIONS_SECRET` emits one fixed
`synthetic_monitor` failure event and returns HTTP 202. It accepts no body or
free-text properties. Test-fire this hook after configuring the production log
destination and confirm the event is searchable by the returned
`x-request-id`.

The same operations secret protects the account-deletion worker. Store it only
in the deployment secret manager, rotate it after exposure, and never place it
in browser code or monitoring output.
