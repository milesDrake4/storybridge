begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('private', 'stripe_events', 'Stripe event ledger is private');
select has_table(
  'private', 'stripe_reversal_tombstones',
  'reversal tombstones are private'
);
select has_function(
  'private', 'commit_stripe_event',
  array[
    'text','boolean','integer','uuid','text','text','text','timestamptz','text','text',
    'boolean','text','timestamptz','integer','text','text','text','text','text','text','text'
  ],
  'atomic Stripe event transition is available to the service'
);
select ok(
  not has_table_privilege('authenticated', 'private.stripe_events', 'SELECT'),
  'browser users cannot read the event ledger'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.commit_stripe_event(text,boolean,integer,uuid,text,text,text,timestamptz,text,text,boolean,text,timestamptz,integer,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'browser users cannot commit provider events'
);

insert into auth.users (id, email) values
  ('fb000000-0000-4000-8000-000000000001', 'stripe-one@example.test'),
  ('fb000000-0000-4000-8000-000000000002', 'stripe-two@example.test'),
  ('fb000000-0000-4000-8000-000000000003', 'stripe-three@example.test'),
  ('fb000000-0000-4000-8000-000000000004', 'stripe-four@example.test');

insert into private.checkout_sessions (
  binding_id, user_id, season, stripe_checkout_session_id,
  expected_price_id, expected_amount_cents, expected_currency, mode,
  provider_expires_at, status, checkout_url, user_binding_hmac,
  idempotency_key_hmac, request_hmac, created_at, updated_at
) values
  (
    'fb100000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000001', '2026-2027', 'cs_test_paid_one',
    'price_season_pass', 2499, 'usd', 'payment', '2026-08-11T00:00:00Z', 'OPEN',
    'https://checkout.stripe.com/c/pay/cs_test_paid_one',
    'v1.' || repeat('u', 43), 'v1.' || repeat('i', 43),
    'v1.' || repeat('r', 43), '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
  ),
  (
    'fb100000-0000-4000-8000-000000000002',
    'fb000000-0000-4000-8000-000000000002', '2026-2027', 'cs_test_paid_two',
    'price_season_pass', 2499, 'usd', 'payment', '2026-08-11T00:00:00Z', 'OPEN',
    'https://checkout.stripe.com/c/pay/cs_test_paid_two',
    'v1.' || repeat('u', 43), 'v1.' || repeat('j', 43),
    'v1.' || repeat('s', 43), '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
  ),
  (
    'fb100000-0000-4000-8000-000000000004',
    'fb000000-0000-4000-8000-000000000004', '2026-2027', 'cs_test_expired_four',
    'price_season_pass', 2499, 'usd', 'payment', '2026-08-11T00:00:00Z', 'OPEN',
    'https://checkout.stripe.com/c/pay/cs_test_expired_four',
    'v1.' || repeat('u', 43), 'v1.' || repeat('l', 43),
    'v1.' || repeat('v', 43), '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
  );

create function pg_temp.commit_event(
  event_id text,
  action text,
  binding_id uuid,
  session_id text,
  payment_intent_id text,
  charge_id text,
  received_at timestamptz
)
returns text
language sql
as $$
  select private.commit_stripe_event(
    action, false, 2499, binding_id, charge_id, 'usd', 'cus_test_storybridge',
    received_at - interval '1 minute', event_id,
    case action
      when 'COMPLETE' then 'checkout.session.completed'
      when 'EXPIRE' then 'checkout.session.expired'
      when 'REFUND' then 'charge.refunded'
      else 'charge.dispute.created'
    end,
    false, 'payment', received_at, 10, 'v1.' || repeat('p', 43),
    payment_intent_id, 'price_season_pass', null, '2026-2027', session_id,
    'v1.' || repeat('u', 43)
  );
$$;

select is(
  pg_temp.commit_event(
    'evt_complete_one', 'COMPLETE', 'fb100000-0000-4000-8000-000000000001',
    'cs_test_paid_one', 'pi_test_paid_one', 'ch_test_paid_one',
    '2026-08-10T13:00:00Z'
  ),
  'PROCESSED', 'a fully correlated completion is processed'
);
select is(
  (select status from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  'ACTIVE', 'completion grants active season access'
);
select is(
  pg_temp.commit_event(
    'evt_complete_one', 'COMPLETE', 'fb100000-0000-4000-8000-000000000001',
    'cs_test_paid_one', 'pi_test_paid_one', 'ch_test_paid_one',
    '2026-08-10T13:01:00Z'
  ),
  'REPLAY', 'the same event cannot grant twice'
);
select is(
  (select count(*) from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  1::bigint, 'completion replay leaves one entitlement'
);

select is(
  pg_temp.commit_event(
    'evt_refund_one', 'REFUND', 'fb100000-0000-4000-8000-000000000001',
    'cs_test_paid_one', 'pi_test_paid_one', 'ch_test_paid_one',
    '2026-08-10T13:02:00Z'
  ),
  'PROCESSED', 'a correlated full refund is processed'
);
select is(
  pg_temp.commit_event(
    'evt_late_complete', 'COMPLETE', 'fb100000-0000-4000-8000-000000000001',
    'cs_test_paid_one', 'pi_test_paid_one', 'ch_test_paid_one',
    '2026-08-10T13:03:00Z'
  ),
  'PROCESSED', 'a late completion is safely recorded'
);
select is(
  (select status from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  'REFUNDED', 'late completion cannot reactivate refunded access'
);
select is(
  pg_temp.commit_event(
    'evt_dispute_one', 'REVOKE', 'fb100000-0000-4000-8000-000000000001',
    'cs_test_paid_one', 'pi_test_paid_one', 'ch_test_paid_one',
    '2026-08-10T13:04:00Z'
  ),
  'PROCESSED', 'a dispute upgrades the terminal state'
);
select is(
  (select status from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  'REVOKED', 'dispute priority is higher than refund priority'
);

select is(
  pg_temp.commit_event(
    'evt_refund_first', 'REFUND', 'fb100000-0000-4000-8000-000000000002',
    'cs_test_paid_two', 'pi_test_paid_two', 'ch_test_paid_two',
    '2026-08-10T13:05:00Z'
  ),
  'PROCESSED', 'a reversal before completion creates a tombstone'
);
select is(
  pg_temp.commit_event(
    'evt_complete_second', 'COMPLETE', 'fb100000-0000-4000-8000-000000000002',
    'cs_test_paid_two', 'pi_test_paid_two', 'ch_test_paid_two',
    '2026-08-10T13:06:00Z'
  ),
  'PROCESSED', 'completion after a tombstone is recorded'
);
select is(
  (select status from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000002' and kind = 'SEASON_PASS'),
  'REFUNDED', 'reversal-first ordering never creates active access'
);

select is(
  pg_temp.commit_event(
    'evt_retry_binding', 'COMPLETE', 'fb100000-0000-4000-8000-000000000003',
    'cs_test_paid_three', 'pi_test_paid_three', 'ch_test_paid_three',
    '2026-08-10T13:07:00Z'
  ),
  'RETRY_PENDING', 'missing local correlation remains retryable'
);

insert into private.checkout_sessions (
  binding_id, user_id, season, stripe_checkout_session_id,
  expected_price_id, expected_amount_cents, expected_currency, mode,
  provider_expires_at, status, checkout_url, user_binding_hmac,
  idempotency_key_hmac, request_hmac, created_at, updated_at
) values (
  'fb100000-0000-4000-8000-000000000003',
  'fb000000-0000-4000-8000-000000000003', '2026-2027', 'cs_test_paid_three',
  'price_season_pass', 2499, 'usd', 'payment', '2026-08-11T00:00:00Z', 'OPEN',
  'https://checkout.stripe.com/c/pay/cs_test_paid_three',
  'v1.' || repeat('u', 43), 'v1.' || repeat('k', 43),
  'v1.' || repeat('t', 43), '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
);

select is(
  pg_temp.commit_event(
    'evt_retry_binding', 'COMPLETE', 'fb100000-0000-4000-8000-000000000003',
    'cs_test_paid_three', 'pi_test_paid_three', 'ch_test_paid_three',
    '2026-08-10T13:08:00Z'
  ),
  'PROCESSED', 'the same retry-pending event resumes after correlation arrives'
);
select is(
  (select status from private.stripe_events where event_id = 'evt_retry_binding'),
  'PROCESSED', 'resumed work becomes terminal in the event ledger'
);

select is(
  pg_temp.commit_event(
    'evt_expire_four', 'EXPIRE', 'fb100000-0000-4000-8000-000000000004',
    'cs_test_expired_four', null, null, '2026-08-10T13:09:00Z'
  ),
  'PROCESSED', 'a correlated expiration closes an open checkout'
);
select is(
  pg_temp.commit_event(
    'evt_completion_after_expiry', 'COMPLETE',
    'fb100000-0000-4000-8000-000000000004', 'cs_test_expired_four',
    'pi_test_expired_four', 'ch_test_expired_four', '2026-08-10T13:10:00Z'
  ),
  'REJECTED', 'completion cannot reactivate an expired checkout'
);
select is(
  (select count(*) from private.entitlements
   where user_id = 'fb000000-0000-4000-8000-000000000004' and kind = 'SEASON_PASS'),
  0::bigint, 'expired checkout ordering never grants an entitlement'
);

select * from finish();
rollback;
