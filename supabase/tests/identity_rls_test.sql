begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_schema('private', 'private schema exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('private', 'beta_invitations', 'beta invitations table exists');
select has_table('private', 'account_deletions', 'account deletions table exists');
select has_pk('public', 'profiles', 'profiles has a primary key');
select has_pk('private', 'beta_invitations', 'beta invitations has a primary key');
select has_pk('private', 'account_deletions', 'account deletions has a primary key');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.beta_invitations'::regclass),
  'beta invitations has defense-in-depth RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.account_deletions'::regclass),
  'account deletions has defense-in-depth RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users can select profiles through RLS'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous users have no profile access'
);
select ok(
  not has_table_privilege('authenticated', 'private.beta_invitations', 'SELECT')
  and not has_table_privilege('authenticated', 'private.beta_invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'private.beta_invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.beta_invitations', 'DELETE')
  and not has_table_privilege('authenticated', 'private.beta_cohort_state', 'UPDATE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated users have no invitation table privileges'
);
select ok(
  not has_table_privilege('authenticated', 'private.account_deletions', 'SELECT')
  and not has_table_privilege('authenticated', 'private.account_deletions', 'INSERT')
  and not has_table_privilege('authenticated', 'private.account_deletions', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.account_deletions', 'DELETE')
  and not has_schema_privilege('anon', 'private', 'USAGE'),
  'authenticated users have no deletion table privileges'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
  'display name is user-editable'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'birth_year', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'age_confirmed_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'privacy_version', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'responsible_use_version', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'consented_at', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'eligibility and policy fields are server-controlled'
);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'other@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'underage@example.test');

insert into public.profiles (
  user_id,
  display_name,
  birth_year,
  age_confirmed_at,
  terms_version,
  privacy_version,
  responsible_use_version,
  consented_at,
  onboarding_state
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'Owner',
    2000,
    '2026-08-02T12:00:00Z',
    'terms-v1',
    'privacy-v1',
    'responsible-v1',
    '2026-08-02T12:00:00Z',
    'NOT_STARTED'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Other',
    2000,
    '2026-08-02T12:00:00Z',
    'terms-v1',
    'privacy-v1',
    'responsible-v1',
    '2026-08-02T12:00:00Z',
    'NOT_STARTED'
  );

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

select results_eq(
  $$select user_id from public.profiles order by user_id$$,
  $$values ('10000000-0000-0000-0000-000000000001'::uuid)$$,
  'an authenticated user can only read their own profile'
);
select lives_ok(
  $$update public.profiles set display_name = 'Updated' where user_id = '10000000-0000-0000-0000-000000000001'$$,
  'an authenticated user can update an allowed column on their own profile'
);
select is_empty(
  $$update public.profiles set display_name = 'Blocked' where user_id = '10000000-0000-0000-0000-000000000002' returning user_id$$,
  'cross-user profile updates are hidden by RLS'
);
select throws_ok(
  $$update public.profiles set terms_version = 'attacker-v1' where user_id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'authenticated users cannot update policy versions directly'
);
select throws_ok(
  $$insert into private.beta_invitations (normalized_email_hmac, status, expires_at) values ('v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'PENDING', now() + interval '1 day')$$,
  '42501',
  null,
  'authenticated users cannot mutate invitations directly'
);
select throws_ok(
  $$update private.account_deletions set status = 'COMPLETE'$$,
  '42501',
  null,
  'authenticated users cannot mutate deletion state directly'
);

reset role;

select throws_ok(
  $$insert into public.profiles (user_id, birth_year, age_confirmed_at, terms_version, privacy_version, responsible_use_version, consented_at, onboarding_state) values ('10000000-0000-0000-0000-000000000003', 2010, '2026-08-02T12:00:00Z', 'terms-v1', 'privacy-v1', 'responsible-v1', '2026-08-02T12:00:00Z', 'NOT_STARTED')$$,
  '23514',
  null,
  'the database rejects an under-18 profile'
);

insert into auth.users (id, email)
select
  ('20000000-0000-0000-0000-' || lpad(sequence_number::text, 12, '0'))::uuid,
  'accepted-' || sequence_number || '@example.test'
from generate_series(1, 26) as accepted_users(sequence_number);

insert into private.beta_invitations (
  normalized_email_hmac,
  status,
  expires_at,
  accepted_user_id
)
select
  'v1.' || lpad(sequence_number::text, 43, 'a'),
  'ACCEPTED',
  now() + interval '1 day',
  ('20000000-0000-0000-0000-' || lpad(sequence_number::text, 12, '0'))::uuid
from generate_series(1, 25) as accepted_invitations(sequence_number);

select is(
  (select count(*) from private.beta_invitations where status = 'ACCEPTED'),
  25::bigint,
  'the cohort can contain 25 accepted invitations'
);
select throws_ok(
  $$insert into private.beta_invitations (normalized_email_hmac, status, expires_at, accepted_user_id) values ('v1.' || repeat('z', 43), 'ACCEPTED', now() + interval '1 day', '20000000-0000-0000-0000-000000000026')$$,
  'P0001',
  'accepted invitation cap of 25 reached',
  'a 26th accepted invitation is rejected atomically'
);
select throws_ok(
  $$insert into private.beta_invitations (normalized_email_hmac, status, expires_at) values ('v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'PENDING', now() + interval '1 day'), ('v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'PENDING', now() + interval '2 days')$$,
  '23505',
  null,
  'only one active invitation can exist per email HMAC'
);

set local role anon;
select throws_ok(
  $$select user_id from public.profiles$$,
  '42501',
  null,
  'anonymous profile reads are denied'
);
reset role;

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'beta_invitations'
      and indexname = 'beta_invitations_active_email_hmac_idx'
  ),
  'active invitation lookups have a partial unique index'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'account_deletions'
      and indexname = 'account_deletions_user_id_id_key'
  ),
  'account deletion ownership lookups are indexed'
);

select * from finish();
rollback;
