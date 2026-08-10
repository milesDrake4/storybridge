# AI budget and beta-cap runbook

This runbook is for the invitation-only production beta. The database remains
the enforcement authority. Provider alerts are an independent warning layer,
not a replacement for the atomic reservation ceiling.

## Required production controls

- `BETA_ACCOUNT_CAP=25` and `MONTHLY_OPENAI_BUDGET_CENTS=15000` pass
  `node scripts/validate-deployment-environment.mjs` in the production scope.
- OpenAI project billing notifications are enabled below and at the USD $150
  application ceiling. Record dashboard evidence without exposing a key,
  organization ID, student content, or provider request body.
- The production database was reconstructed from reviewed migrations. The
  invitation trigger cannot increment `private.beta_cohort_state.accepted_count`
  beyond 25, and AI reservations reject a request that would exceed the monthly
  ceiling before provider start.

## Content-free checks

Run these read-only queries in the production Supabase SQL editor. Store only
the aggregate results in release evidence.

```sql
select accepted_count
from private.beta_cohort_state
where singleton;

select coalesce(
  sum(coalesce(reservations.final_cost_cents, reservations.estimated_cost_cents)),
  0
) as committed_or_reserved_cents
from private.usage_reservations reservations
join private.ai_operations operations
  on operations.id = reservations.operation_id
where reservations.budget_month_start = date_trunc('month', now() at time zone 'UTC')::date
  and reservations.released_at is null
  and (
    operations.provider_started_at is not null
    or reservations.expires_at > now()
  );
```

Do not query or export user IDs, IP HMACs, request HMACs, prompts, drafts, or
interview text for a budget incident.

## Alert response

### `AI_BUDGET_EXHAUSTED`

1. Keep AI reservations closed; do not raise the ceiling during triage.
2. Compare the content-free database total with the provider billing dashboard.
3. Check for retry amplification using operation status and purpose counts only.
4. Disable invitations if unexpected spend is continuing.
5. The owner may lower the ceiling immediately. Raising it above USD $150
   requires a reviewed specification change and explicit owner approval.

### `BETA_CAP_REACHED`

1. Compare `accepted_count` with the count of accepted invitation rows.
2. If both are 25, the system is behaving correctly; do not admit another user.
3. If they differ, disable invitation acceptance, preserve the rows, and repair
   only through a reviewed migration or transaction.
4. Never delete an accepted invitation merely to conceal a counter mismatch.

## Recovery evidence

Record UTC time, responder, safe request ID, aggregate database result, provider
dashboard result, action taken, and resolution. Never paste a provider error,
student content, authentication value, or raw request into the incident record.
