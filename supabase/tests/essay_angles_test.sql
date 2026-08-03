begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

select has_table('public', 'essay_angles', 'essay angles table exists');
select has_table('public', 'angle_story_facts', 'angle fact links exist');
select has_table('public', 'angle_school_sources', 'angle source links exist');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.essay_angles'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.angle_story_facts'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.angle_school_sources'::regclass),
  'all angle graph tables enforce RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.essay_angles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.essay_angles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.angle_story_facts', 'UPDATE'),
  'browser roles can read but cannot mutate the graph'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.commit_essay_angles(uuid,uuid,uuid,uuid,boolean,jsonb,text,text,integer,integer,integer,integer,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot invoke the angle commit'
);

insert into auth.users (id, email)
values ('e0000000-0000-4000-8000-000000000001', 'angles-owner@example.test');
insert into private.beta_invitations (
  normalized_email_hmac, status, expires_at, accepted_user_id
) values (
  'v1.' || repeat('u', 43), 'ACCEPTED', now() + interval '1 day',
  'e0000000-0000-4000-8000-000000000001'
);

insert into public.interview_sessions (
  id, user_id, status, coverage, current_question_key, completed_at
) values (
  'e0100000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', 'COMPLETE',
  '{"academicInterests":true,"experiences":2,"activities":true,"responsibilities":true,"values":true,"goals":true,"voice":true}'::jsonb,
  null, '2026-08-03T20:00:00Z'
);
insert into public.story_profiles (
  id, user_id, source_session_id, version, status, voice_profile
) values (
  'e0200000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'e0100000-0000-4000-8000-000000000001', 1, 'ACTIVE',
  '{"toneTraits":["direct"],"sentenceStyle":"varied","vocabulary":"plain"}'::jsonb
);
insert into public.story_facts (
  id, user_id, profile_id, category, summary, details, content_hmac,
  verification_status, verified_at
) values
(
  'e0300000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'e0200000-0000-4000-8000-000000000001', 'EXPERIENCES',
  'Built community through a repair workshop.', '["Organized a repair workshop."]'::jsonb,
  'v1.' || repeat('V', 43), 'VERIFIED', '2026-08-03T20:00:00Z'
),
(
  'e0300000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001',
  'e0200000-0000-4000-8000-000000000001', 'VALUES',
  'This fact was not verified.', '["Unverified detail."]'::jsonb,
  'v1.' || repeat('W', 43), 'UNVERIFIED', null
);

create temp table angle_essay as
select (private.create_essay_workspace(
  'e0000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'How will your experiences help you contribute to our community?', 300,
  'v1.' || repeat('X', 43), 'v1.' || repeat('Y', 43), '2026-08-03T20:00:01Z'
) -> 'essay' ->> 'id')::uuid as id;

create temp table research_operation as
select operation_id from private.reserve_ai_operation(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('a', 43),
  'v1.' || repeat('b', 43), 'v1.' || repeat('c', 43), 'SCHOOL_RESEARCH',
  50, 25, 15000, 25, '2026-08-03T20:00:02Z'
);
select is(
  private.start_ai_operation((select operation_id from research_operation), '2026-08-03T20:00:03Z'),
  'STARTED', 'research prerequisite starts'
);
select private.commit_school_dossier(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  (select operation_id from research_operation),
  jsonb_build_object(
    'schemaVersion', '1', 'summary', 'Community evidence.',
    'sources', jsonb_build_array(jsonb_build_object(
      'category', 'COMMUNITY', 'claim', 'Students collaborate through projects.',
      'title', 'Community', 'supportingExcerpt', 'Projects connect students across fields.',
      'normalizedUrl', 'https://umich.edu/community',
      'retrievedAt', '2026-08-03T19:55:00Z'
    ))
  ),
  'research-provider', 'research-model', 100, 50, 500, 25,
  '2026-08-03T20:00:04Z'
);

create temp table angle_payload as
select jsonb_build_array(
  jsonb_build_object(
    'title', 'Repair as relationship', 'thesis', 'Repairing objects built trust.',
    'promptFit', 'Connects service to contribution.', 'risk', 'Stay specific.',
    'storyFactIds', jsonb_build_array('e0300000-0000-4000-8000-000000000001'),
    'schoolSourceIds', jsonb_build_array(sources.id)
  ),
  jsonb_build_object(
    'title', 'Curiosity made useful', 'thesis', 'Technical curiosity became shared value.',
    'promptFit', 'Shows contribution through curiosity.', 'risk', 'Center people.',
    'storyFactIds', jsonb_build_array('e0300000-0000-4000-8000-000000000001'),
    'schoolSourceIds', jsonb_build_array(sources.id)
  ),
  jsonb_build_object(
    'title', 'Leadership by listening', 'thesis', 'Listening changed how I lead.',
    'promptFit', 'Shows community-minded growth.', 'risk', 'Name one moment.',
    'storyFactIds', jsonb_build_array('e0300000-0000-4000-8000-000000000001'),
    'schoolSourceIds', jsonb_build_array(sources.id)
  )
) as payload
from public.school_dossier_sources sources
where sources.dossier_id = (select dossier_id from public.essays where id = (select id from angle_essay));

create temp table angle_operation as
select operation_id from private.reserve_ai_operation(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  'POST', '/api/v1/essays/{essayId}/angles', 'v1.' || repeat('d', 43),
  'v1.' || repeat('e', 43), 'v1.' || repeat('f', 43), 'ANGLE_GENERATION',
  50, 20, 15000, 20, '2026-08-03T20:01:00Z'
);
select is(
  private.start_ai_operation((select operation_id from angle_operation), '2026-08-03T20:01:01Z'),
  'STARTED', 'angle generation starts'
);
create temp table angle_result as
select private.commit_essay_angles(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  (select dossier_id from public.essays where id = (select id from angle_essay)),
  (select operation_id from angle_operation), false, (select payload from angle_payload),
  'angle-provider', 'angle-model', 200, 100, 700, 20, '2026-08-03T20:01:02Z'
) as data;

select is((select data ->> 'decision' from angle_result), 'CREATED', 'three valid angles commit');
select is((select count(*) from public.essay_angles), 3::bigint, 'exactly three angles persist');
select is((select count(*) from public.angle_story_facts), 3::bigint, 'every angle links a verified fact');
select is((select count(*) from public.angle_school_sources), 3::bigint, 'every angle links a current source');
select is((select angle_generation_count from public.essays), 1::smallint, 'initial generation is counted');
select is(
  (select status from private.ai_operations where id = (select operation_id from angle_operation)),
  'SUCCEEDED', 'generation finalizes atomically'
);
select is(
  private.commit_essay_angles(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select dossier_id from public.essays where id = (select id from angle_essay)),
    (select operation_id from angle_operation), false, '[]'::jsonb,
    'changed', 'changed', 0, 0, 0, 0, '2026-08-03T20:01:03Z'
  ) ->> 'decision',
  'REPLAY', 'same operation replays the immutable set'
);

create temp table invalid_operation as
select operation_id from private.reserve_ai_operation(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  'POST', '/api/v1/essays/{essayId}/angles', 'v1.' || repeat('g', 43),
  'v1.' || repeat('h', 43), 'v1.' || repeat('i', 43), 'ANGLE_GENERATION',
  50, 20, 15000, 20, '2026-08-03T20:02:00Z'
);
select is(
  private.start_ai_operation((select operation_id from invalid_operation), '2026-08-03T20:02:01Z'),
  'STARTED', 'invalid regeneration operation starts'
);
select is(
  private.commit_essay_angles(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select dossier_id from public.essays where id = (select id from angle_essay)),
    (select operation_id from invalid_operation), true,
    jsonb_set(
      (select payload from angle_payload),
      '{0,storyFactIds}',
      '["e0300000-0000-4000-8000-000000000002"]'::jsonb
    ),
    'invalid-provider', 'angle-model', 200, 100, 700, 20, '2026-08-03T20:02:02Z'
  ) ->> 'decision',
  'EVIDENCE_INVALID', 'unverified evidence is rejected before replacement'
);
select is((select count(*) from public.essay_angles), 3::bigint, 'invalid evidence keeps the prior set');
select is((select angle_generation_count from public.essays), 1::smallint, 'invalid evidence consumes no regeneration');

create temp table regenerate_operation as
select operation_id from private.reserve_ai_operation(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
  'POST', '/api/v1/essays/{essayId}/angles', 'v1.' || repeat('j', 43),
  'v1.' || repeat('k', 43), 'v1.' || repeat('l', 43), 'ANGLE_GENERATION',
  50, 20, 15000, 20, '2026-08-03T20:03:00Z'
);
select is(
  private.start_ai_operation((select operation_id from regenerate_operation), '2026-08-03T20:03:01Z'),
  'STARTED', 'one regeneration starts'
);
select is(
  private.commit_essay_angles(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select dossier_id from public.essays where id = (select id from angle_essay)),
    (select operation_id from regenerate_operation), true,
    jsonb_set(jsonb_set(jsonb_set(
      (select payload from angle_payload),
      '{0,title}', '"Regenerated one"'::jsonb
    ), '{1,title}', '"Regenerated two"'::jsonb), '{2,title}', '"Regenerated three"'::jsonb),
    'regen-provider', 'angle-model', 200, 100, 700, 20, '2026-08-03T20:03:02Z'
  ) ->> 'decision',
  'CREATED', 'one regeneration atomically replaces the set'
);
select is((select count(*) from public.essay_angles), 3::bigint, 'regeneration leaves exactly three current angles');
select is((select angle_generation_count from public.essays), 2::smallint, 'regeneration is atomically counted');
select is(
  private.commit_essay_angles(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select dossier_id from public.essays where id = (select id from angle_essay)),
    gen_random_uuid(), true, (select payload from angle_payload),
    'third-provider', 'angle-model', 200, 100, 700, 20, '2026-08-03T20:04:00Z'
  ) ->> 'decision',
  'REGENERATION_USED', 'a second regeneration is rejected'
);
select is((select count(*) from public.essay_angles), 3::bigint, 'rejected second regeneration changes nothing');

create temp table selected_angle as
select id from public.essay_angles order by position limit 1;
select is(
  private.update_essay_angle(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select id from selected_angle), 1, 'Student-edited strategy',
    'A student-edited thesis grounded in the same evidence.',
    '2026-08-03T20:04:30Z'
  ) ->> 'decision',
  'UPDATED', 'a current ETag persists an owned angle edit'
);
select is(
  (select title from public.essay_angles where id = (select id from selected_angle)),
  'Student-edited strategy', 'the angle edit survives reload'
);
select is((select revision from public.essays), 2, 'angle editing advances the essay revision');
select is(
  private.update_essay_angle(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select id from selected_angle), 1, 'Stale replacement', 'Stale thesis.',
    '2026-08-03T20:04:31Z'
  ) ->> 'decision',
  'REVISION_MISMATCH', 'a stale edit cannot replace newer strategy text'
);
select is(
  private.select_essay_angle(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select id from selected_angle), '2026-08-03T20:05:00Z'
  ) ->> 'decision',
  'SELECTED', 'an owned current-dossier angle is selected atomically'
);
select is(
  (select selected_angle_id from public.essays),
  (select id from selected_angle),
  'selection persists on the essay for reload'
);
select is((select status from public.essays), 'OUTLINING', 'selection advances the workflow');
select is(
  private.select_essay_angle(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    (select id from selected_angle), '2026-08-03T20:05:01Z'
  ) ->> 'decision',
  'REPLAY', 'repeated selection is idempotent'
);
select is(
  private.select_essay_angle(
    'e0000000-0000-4000-8000-000000000001', (select id from angle_essay),
    'e9999999-0000-4000-8000-000000000001', '2026-08-03T20:05:02Z'
  ) ->> 'decision',
  'NOT_FOUND', 'an unrelated angle is masked as missing'
);

select private.invalidate_essay_research_dependents(
  'e0000000-0000-4000-8000-000000000001', (select id from angle_essay)
);
select is((select count(*) from public.essay_angles), 0::bigint, 'research invalidation deletes prior angles');
select is((select angle_generation_count from public.essays), 0::smallint, 'research invalidation resets generation allowance');

select * from finish();
rollback;
