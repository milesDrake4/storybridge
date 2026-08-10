# Stripe webhook recovery runbook

StoryBridge grants and reverses paid access only through verified, field-bound,
idempotent Stripe events. A Checkout redirect is not authorization.

## Detection

Investigate when `WEBHOOK_RETRY_PENDING` is emitted, Stripe reports sustained
delivery failures, or the oldest retry is more than ten minutes old. Use event
IDs, binding IDs, status, timestamps, safe failure codes, and HTTP outcomes only.
Do not copy webhook payloads, email addresses, essay text, or secret values into
logs or tickets.

## Triage

1. Confirm the production endpoint is HTTPS and Stripe still uses its expected
   restricted live-mode webhook secret.
2. Confirm the endpoint accepts the raw body before parsing and verifies the
   signature and event age.
3. Inspect the content-free queue:

```sql
select event_id, event_type, status, safe_failure_code,
       operator_alert_required, received_at, updated_at
from private.stripe_events
where status = 'RETRY_PENDING' or operator_alert_required
order by received_at asc;
```

4. For `BINDING_NOT_FOUND`, allow Stripe to retry while confirming that the
   matching Checkout binding committed. Do not create an entitlement manually.
5. For a signature, amount, currency, price, mode, livemode, customer, or user
   binding mismatch, keep the event rejected and escalate as a security issue.

## Replay and reversal

- Prefer Stripe's dashboard retry for the original event. Never synthesize a
  production completion or edit the event ledger.
- Replaying the same event ID and payload is safe; a different payload under the
  same ID remains rejected.
- A full `charge.refunded` or dispute/revocation event must leave the entitlement
  terminally `REFUNDED` or `REVOKED`. A late completion must not reactivate it.
- Do not restore access manually after a refund. A new purchase must create a
  new field-bound Checkout session.

## Live release smoke

Before paid invitations open, the owner uses a dedicated adult synthetic account
to make one USD $24.99 live-mode purchase, confirms the paid allowance, issues a
full refund, and confirms the entitlement is reversed. Record Stripe event IDs,
UTC timestamps, terminal states, and reviewer—not card details, email, webhook
body, or student content. Refund timing and fees are an owner-approved launch
cost and are not automated by the test suite.

## Closeout

Confirm the retry queue is empty or every remaining row has an owner and next
check time. Rotate the webhook secret if exposure is suspected, update only the
production secret scope, redeploy, and test a newly signed event before closing.
