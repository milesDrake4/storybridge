begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select has_column(
  'private', 'account_deletions', 'deletion_idempotency_key_hmac',
  'deletion requests persist only the idempotency HMAC'
);
select has_column(
  'private', 'account_deletions', 'attempt_count',
  'deletion jobs persist a bounded retry count'
);
select has_function(
  'private', 'queue_account_deletion',
  array['uuid','text','text','text','timestamptz'],
  'account deletion queue transition exists'
);
select has_function(
  'private', 'get_account_export', array['uuid','integer','timestamptz'],
  'bounded account export operation exists'
);
select has_function(
  'private', 'get_account_deletion_status',
  array['text','timestamptz'],
  'token-scoped deletion status lookup exists'
);
select has_function(
  'private', 'claim_next_account_deletion', array['timestamptz'],
  'non-blocking account deletion worker claim exists'
);
select has_function(
  'private', 'complete_account_deletion', array['uuid','timestamptz'],
  'account deletion completion transition exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.queue_account_deletion(uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot queue another user deletion directly'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.get_account_export(uuid,integer,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot export another user through the private operation'
);
select ok(
  not has_table_privilege(
    'authenticated', 'private.account_deletions', 'SELECT'
  ),
  'browser roles cannot enumerate deletion records or token HMACs'
);

insert into auth.users (id, email) values
  ('ff200000-0000-4000-8000-000000000001', 'delete-one@example.test'),
  ('ff200000-0000-4000-8000-000000000002', 'delete-two@example.test');
insert into public.profiles (
  user_id, birth_year, age_confirmed_at,
  terms_version, privacy_version, responsible_use_version, consented_at
) values
  ('ff200000-0000-4000-8000-000000000001', 2000,
   '2026-08-01T00:00:00Z', 'terms-2026-08-02', 'privacy-2026-08-02',
   'responsible-use-2026-08-02', '2026-08-01T00:00:00Z'),
  ('ff200000-0000-4000-8000-000000000002', 2000,
   '2026-08-01T00:00:00Z', 'terms-2026-08-02', 'privacy-2026-08-02',
   'responsible-use-2026-08-02', '2026-08-01T00:00:00Z');
insert into private.beta_invitations (
  normalized_email_hmac, status, expires_at, accepted_user_id
) values (
  'v1.' || repeat('q', 43), 'ACCEPTED', now() + interval '1 day',
  'ff200000-0000-4000-8000-000000000001'
);

update public.profiles set display_name = 'Other user private name'
where user_id = 'ff200000-0000-4000-8000-000000000002';

create temp table account_export as
select private.get_account_export(
  'ff200000-0000-4000-8000-000000000001', 5242880,
  '2026-08-10T17:59:00Z'
) as result;
select is(
  (select result ->> 'decision' from account_export),
  'READY', 'an authenticated caller export is assembled'
);
select is(
  (select result -> 'export' -> 'profile' ->> 'user_id' from account_export),
  'ff200000-0000-4000-8000-000000000001',
  'the export is owner scoped'
);
select ok(
  (select result::text not like '%Other user private name%'
     and position('_hmac' in result::text) = 0
   from account_export),
  'the export excludes other users and internal HMAC fields'
);

create temp table queued_deletion as
select private.queue_account_deletion(
  'ff200000-0000-4000-8000-000000000001',
  'v1.' || repeat('a', 43),
  'v1.' || repeat('b', 43),
  'v1.' || repeat('c', 43),
  '2026-08-10T18:00:00Z'
) as result;

select is(
  (select result ->> 'decision' from queued_deletion),
  'QUEUED', 'the first authenticated request is queued'
);
select is(
  (select count(*) from private.account_deletions
   where user_id = 'ff200000-0000-4000-8000-000000000001'
     and user_id_hmac = 'v1.' || repeat('a', 43)
     and deletion_status_token_hmac = 'v1.' || repeat('b', 43)
     and deletion_idempotency_key_hmac = 'v1.' || repeat('c', 43)),
  1::bigint, 'only purpose-scoped HMACs are persisted'
);
select is(
  private.queue_account_deletion(
    'ff200000-0000-4000-8000-000000000001',
    'v1.' || repeat('a', 43), 'v1.' || repeat('b', 43),
    'v1.' || repeat('c', 43), '2026-08-10T18:01:00Z'
  ) ->> 'decision',
  'REPLAY', 'the same deletion key replays atomically'
);
select is(
  private.queue_account_deletion(
    'ff200000-0000-4000-8000-000000000001',
    'v1.' || repeat('a', 43), 'v1.' || repeat('d', 43),
    'v1.' || repeat('e', 43), '2026-08-10T18:02:00Z'
  ) ->> 'decision',
  'CONFLICT', 'a second key cannot create a concurrent deletion'
);
select is(
  private.get_account_deletion_status(
    'v1.' || repeat('b', 43), '2026-08-10T18:03:00Z'
  ) ->> 'status',
  'QUEUED', 'the bearer-token HMAC resolves only its queued status'
);
select is(
  private.get_account_deletion_status(
    'v1.' || repeat('z', 43), '2026-08-10T18:03:00Z'
  ),
  null::jsonb, 'an unknown token reveals no deletion metadata'
);
select is(
  private.get_account_deletion_status(
    'v1.' || repeat('b', 43), '2026-09-10T18:00:01Z'
  ),
  null::jsonb, 'an expired token reveals no deletion metadata'
);

create temp table claimed_deletion as
select private.claim_next_account_deletion('2026-08-10T18:04:00Z') as result;
select is(
  (select result ->> 'status' from claimed_deletion),
  'PROCESSING', 'a worker atomically claims the oldest queued deletion'
);
select is(
  (select (result ->> 'attempt_count')::integer from claimed_deletion),
  1, 'the worker records its provider attempt atomically with the claim'
);
select is(
  private.claim_next_account_deletion('2026-08-10T18:04:01Z'),
  null::jsonb, 'another worker cannot claim an in-flight deletion'
);
select is(
  private.complete_account_deletion(
    ((select result ->> 'deletion_id' from claimed_deletion))::uuid,
    '2026-08-10T18:05:00Z'
  ),
  false, 'completion is rejected until provider deletion clears the raw user ID'
);
select ok(
  private.prepare_account_deletion(
    ((select result ->> 'deletion_id' from claimed_deletion))::uuid
  ),
  'the worker prepares provider deletion without a long database transaction'
);
select is(
  (select count(*) from private.beta_invitations
   where accepted_user_id = 'ff200000-0000-4000-8000-000000000001'),
  0::bigint, 'provider preparation removes the invitation deletion blocker'
);
select is(
  (select count(*) from public.profiles
   where user_id = 'ff200000-0000-4000-8000-000000000001'),
  0::bigint, 'application data is removed before provider identity deletion'
);

delete from auth.users
where id = 'ff200000-0000-4000-8000-000000000001';

select is(
  (select count(*) from auth.users
   where id = 'ff200000-0000-4000-8000-000000000001'),
  0::bigint, 'the provider identity can be deleted after application cleanup'
);
select is(
  private.complete_account_deletion(
    ((select result ->> 'deletion_id' from claimed_deletion))::uuid,
    '2026-08-10T18:05:00Z'
  ),
  true, 'the worker completes only after provider identity deletion'
);
select is(
  private.get_account_deletion_status(
    'v1.' || repeat('b', 43), '2026-08-10T18:06:00Z'
  ) ->> 'status',
  'COMPLETE', 'the scoped status reports completion'
);
select is(
  (select user_id from private.account_deletions
   where id = ((select result ->> 'deletion_id' from claimed_deletion))::uuid),
  null::uuid, 'completed deletion metadata contains no raw user ID'
);
select is(
  (select expires_at - completed_at from private.account_deletions
   where id = ((select result ->> 'deletion_id' from claimed_deletion))::uuid),
  interval '30 days', 'completed status remains token-visible for exactly 30 days'
);

select * from finish();
rollback;
