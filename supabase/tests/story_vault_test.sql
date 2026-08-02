begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'story_profiles', 'story profiles table exists');
select has_table('public', 'story_facts', 'story facts table exists');
select has_table('public', 'story_fact_sources', 'fact source join table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.story_profiles'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.story_facts'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.story_fact_sources'::regclass),
  'Story Vault tables have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.story_profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.story_facts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.story_fact_sources', 'INSERT')
  and not has_function_privilege(
    'authenticated',
    'private.create_story_profile(uuid,uuid,jsonb,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot mutate Story Vault state'
);

insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'vault-owner@example.test'),
  ('a0000000-0000-4000-8000-000000000002', 'vault-other@example.test');

create temp table vault_session as
select private.start_interview_session(
  'a0000000-0000-4000-8000-000000000001',
  '2026-08-02T16:00:00Z'
) as data;

select is(
  private.create_story_profile(
    'a0000000-0000-4000-8000-000000000001',
    (select (data ->> 'id')::uuid from vault_session),
    '{"voiceProfile":{},"facts":[{}]}'::jsonb,
    '2026-08-02T16:00:01Z'
  ) ->> 'decision',
  'INCOMPLETE',
  'an active interview cannot be extracted'
);

select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'ACADEMIC_INTERESTS', 'Synthetic academics', '2026-08-02T16:00:01Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'EXPERIENCE_CHALLENGE', 'Synthetic challenge', '2026-08-02T16:00:02Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'EXPERIENCE_PRIDE', 'Synthetic pride', '2026-08-02T16:00:03Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'ACTIVITIES', 'Synthetic activities', '2026-08-02T16:00:04Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'RESPONSIBILITIES', 'Synthetic responsibilities', '2026-08-02T16:00:05Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'VALUES', 'Synthetic values', '2026-08-02T16:00:06Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'GOALS', 'Synthetic goals', '2026-08-02T16:00:07Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'VOICE', 'Synthetic voice', '2026-08-02T16:00:08Z');
select private.record_interview_answer('a0000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from vault_session), 'ADDITIONAL_CONTEXT', 'Synthetic context', '2026-08-02T16:00:09Z');

select is(
  private.create_story_profile(
    'a0000000-0000-4000-8000-000000000002',
    (select (data ->> 'id')::uuid from vault_session),
    '{"voiceProfile":{},"facts":[{}]}'::jsonb,
    '2026-08-02T16:00:10Z'
  ) ->> 'decision',
  'NOT_FOUND',
  'cross-user and missing sessions have the same result'
);

create temp table extraction as
select jsonb_build_object(
  'voiceProfile', jsonb_build_object(
    'toneTraits', jsonb_build_array('reflective'),
    'sentenceStyle', 'Direct, then reflective',
    'vocabulary', 'Concrete and restrained'
  ),
  'facts', jsonb_build_array(
    jsonb_build_object(
      'category', 'ACADEMICS',
      'summary', 'Returns to an academic interest',
      'details', jsonb_build_array('Synthetic academic detail'),
      'contentHmac', 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'sourceMessageIds', jsonb_build_array((
        select id from public.interview_messages
        where user_id = 'a0000000-0000-4000-8000-000000000001'
          and sequence = 1
      ))
    ),
    jsonb_build_object(
      'category', 'VALUES',
      'summary', 'Names a value through an experience',
      'details', jsonb_build_array('Synthetic value detail'),
      'contentHmac', 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      'sourceMessageIds', jsonb_build_array((
        select id from public.interview_messages
        where user_id = 'a0000000-0000-4000-8000-000000000001'
          and sequence = 11
      ))
    )
  )
) as data;

select throws_ok(
  format(
    $$select private.create_story_profile('a0000000-0000-4000-8000-000000000001', %L, jsonb_set((select data from extraction), '{facts,0,sourceMessageIds,0}', to_jsonb('a0000000-0000-4000-8000-000000000002'::text)), '2026-08-02T16:00:10Z')$$,
    (select data ->> 'id' from vault_session)
  ),
  '22023',
  'invalid story fact source',
  'non-message source identifiers are rejected atomically'
);
select is((select count(*) from public.story_profiles), 0::bigint, 'failed extraction creates no profile');

create temp table created_profile as
select private.create_story_profile(
  'a0000000-0000-4000-8000-000000000001',
  (select (data ->> 'id')::uuid from vault_session),
  (select data from extraction),
  '2026-08-02T16:00:11Z'
) as data;

select is((select data ->> 'decision' from created_profile), 'CREATED', 'valid extraction creates a Story Vault');
select is((select version from public.story_profiles), 1, 'the first Story Vault has version one');
select is((select count(*) from public.story_facts), 2::bigint, 'all extracted facts persist atomically');
select results_eq(
  $$select distinct verification_status from public.story_facts$$,
  $$values ('UNVERIFIED'::text)$$,
  'every extracted fact starts unverified'
);
select is((select count(*) from public.story_fact_sources), 2::bigint, 'facts retain owned source-message links');

select is(
  private.create_story_profile(
    'a0000000-0000-4000-8000-000000000001',
    (select (data ->> 'id')::uuid from vault_session),
    (select data from extraction),
    '2026-08-02T16:00:12Z'
  ) ->> 'decision',
  'REPLAY',
  'completion replays the existing profile'
);
select is((select count(*) from public.story_profiles), 1::bigint, 'replay creates no duplicate profile');

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.story_facts), 2::bigint, 'the owner can review extracted facts');
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.story_facts), 0::bigint, 'another user cannot read extracted facts');
reset role;

select * from finish();
rollback;
