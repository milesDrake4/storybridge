create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(3);

select extensions.dblink_connect(
  'stripe_webhook_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'stripe_webhook_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'stripe_webhook_a',
  $$
    delete from auth.users
    where id = 'fc000000-0000-4000-8000-000000000001';
    insert into auth.users (id, email)
    values ('fc000000-0000-4000-8000-000000000001', 'stripe-concurrent@example.test');
    insert into private.checkout_sessions (
      binding_id, user_id, season, stripe_checkout_session_id,
      expected_price_id, expected_amount_cents, expected_currency, mode,
      provider_expires_at, status, checkout_url, user_binding_hmac,
      idempotency_key_hmac, request_hmac, created_at, updated_at
    ) values (
      'fc100000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001', '2026-2027',
      'cs_test_concurrent', 'price_season_pass', 2499, 'usd', 'payment',
      '2026-08-11T00:00:00Z', 'OPEN',
      'https://checkout.stripe.com/c/pay/cs_test_concurrent',
      'v1.' || repeat('u', 43), 'v1.' || repeat('i', 43),
      'v1.' || repeat('r', 43), '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
    );
  $$
);

select extensions.dblink_send_query(
  'stripe_webhook_a',
  $$select private.commit_stripe_event(
    'COMPLETE', false, 2499, 'fc100000-0000-4000-8000-000000000001',
    'ch_test_concurrent', 'usd', 'cus_test_concurrent', '2026-08-10T12:59:00Z',
    'evt_test_concurrent_complete', 'checkout.session.completed', false, 'payment',
    '2026-08-10T13:00:00Z', 20, 'v1.' || repeat('p', 43),
    'pi_test_concurrent', 'price_season_pass', null, '2026-2027',
    'cs_test_concurrent', 'v1.' || repeat('u', 43)
  )$$
);
select extensions.dblink_send_query(
  'stripe_webhook_b',
  $$select private.commit_stripe_event(
    'REFUND', false, 2499, 'fc100000-0000-4000-8000-000000000001',
    'ch_test_concurrent', 'usd', 'cus_test_concurrent', '2026-08-10T12:59:30Z',
    'evt_test_concurrent_refund', 'charge.refunded', false, 'payment',
    '2026-08-10T13:00:00Z', 20, 'v1.' || repeat('q', 43),
    'pi_test_concurrent', 'price_season_pass', null, '2026-2027',
    'cs_test_concurrent', 'v1.' || repeat('u', 43)
  )$$
);

create temp table concurrent_stripe_results (decision text);
insert into concurrent_stripe_results
select result
from extensions.dblink_get_result('stripe_webhook_a') as response(result text);
insert into concurrent_stripe_results
select result
from extensions.dblink_get_result('stripe_webhook_b') as response(result text);
select count(*) from extensions.dblink_get_result('stripe_webhook_a') as drained(result text);
select count(*) from extensions.dblink_get_result('stripe_webhook_b') as drained(result text);

select is(
  (select count(*) from concurrent_stripe_results where decision = 'PROCESSED'),
  2::bigint,
  'concurrent completion and refund both commit without duplicate processing'
);
select is(
  (select status from private.entitlements
   where user_id = 'fc000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  'REFUNDED',
  'refund remains terminal regardless of concurrent delivery order'
);
select is(
  (select count(*) from private.entitlements
   where user_id = 'fc000000-0000-4000-8000-000000000001' and kind = 'SEASON_PASS'),
  1::bigint,
  'concurrent delivery creates exactly one season entitlement'
);

select extensions.dblink_exec(
  'stripe_webhook_a',
  $$delete from auth.users where id = 'fc000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_disconnect('stripe_webhook_a');
select extensions.dblink_disconnect('stripe_webhook_b');

select * from finish();
