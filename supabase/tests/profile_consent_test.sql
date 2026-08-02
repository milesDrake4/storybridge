begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'private',
  'record_profile_consent',
  array['uuid', 'integer', 'text', 'text', 'text', 'timestamp with time zone'],
  'profile consent RPC exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.record_profile_consent(uuid,integer,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke the consent RPC directly'
);

insert into auth.users (id, email)
values
  ('30000000-0000-4000-8000-000000000001', 'invited@example.test'),
  ('30000000-0000-4000-8000-000000000002', 'uninvited@example.test'),
  ('30000000-0000-4000-8000-000000000003', 'underage@example.test');

insert into private.beta_invitations (
  normalized_email_hmac,
  status,
  expires_at,
  accepted_user_id
)
values
  (
    'v1.' || repeat('e', 43),
    'ACCEPTED',
    now() + interval '1 day',
    '30000000-0000-4000-8000-000000000001'
  ),
  (
    'v1.' || repeat('f', 43),
    'ACCEPTED',
    now() + interval '1 day',
    '30000000-0000-4000-8000-000000000003'
  );

select results_eq(
  $$select user_id, birth_year, terms_version, privacy_version, responsible_use_version from private.record_profile_consent('30000000-0000-4000-8000-000000000001', 2000, 'terms-current', 'privacy-current', 'responsible-current', '2026-08-02T12:00:00Z')$$,
  $$values ('30000000-0000-4000-8000-000000000001'::uuid, 2000, 'terms-current'::text, 'privacy-current'::text, 'responsible-current'::text)$$,
  'an accepted invited adult can create a consent profile'
);
select is(
  (select count(*) from public.profiles where user_id = '30000000-0000-4000-8000-000000000001'),
  1::bigint,
  'consent creates exactly one profile'
);

update public.profiles
set onboarding_state = 'IN_PROGRESS'
where user_id = '30000000-0000-4000-8000-000000000001';

select results_eq(
  $$select birth_year, terms_version, onboarding_state from private.record_profile_consent('30000000-0000-4000-8000-000000000001', 1999, 'terms-next', 'privacy-next', 'responsible-next', '2026-08-03T12:00:00Z')$$,
  $$values (1999, 'terms-next'::text, 'IN_PROGRESS'::text)$$,
  're-consent updates controlled fields without resetting onboarding'
);
select is_empty(
  $$select * from private.record_profile_consent('30000000-0000-4000-8000-000000000002', 2000, 'terms-current', 'privacy-current', 'responsible-current', '2026-08-02T12:00:00Z')$$,
  'an uninvited user cannot bootstrap consent'
);
select throws_ok(
  $$select * from private.record_profile_consent('30000000-0000-4000-8000-000000000003', 2010, 'terms-current', 'privacy-current', 'responsible-current', '2026-08-02T12:00:00Z')$$,
  '23514',
  null,
  'the profile constraint rejects under-18 consent'
);
select is(
  (select count(*) from public.profiles where user_id in ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003')),
  0::bigint,
  'failed consent attempts persist no profile'
);

select * from finish();
rollback;
