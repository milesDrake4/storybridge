begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_function(
  'private',
  'refresh_school_dossier',
  array['uuid', 'uuid', 'integer', 'uuid', 'jsonb', 'text', 'text', 'integer', 'integer', 'integer', 'integer', 'timestamp with time zone'],
  'atomic dossier refresh function exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.refresh_school_dossier(uuid,uuid,integer,uuid,jsonb,text,text,integer,integer,integer,integer,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot invoke dossier refresh'
);

insert into auth.users (id, email)
values ('d0000000-0000-4000-8000-000000000001', 'refresh-owner@example.test');
insert into private.beta_invitations (
  normalized_email_hmac, status, expires_at, accepted_user_id
) values (
  'v1.' || repeat('t', 43), 'ACCEPTED', now() + interval '1 day',
  'd0000000-0000-4000-8000-000000000001'
);

create temp table refresh_essay as
select (private.create_essay_workspace(
  'd0000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe a community that has shaped your perspective.', 300,
  'v1.' || repeat('F', 43), 'v1.' || repeat('G', 43), '2026-08-03T19:00:00Z'
) -> 'essay' ->> 'id')::uuid as id;

create temp table initial_operation as
select operation_id from private.reserve_ai_operation(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay),
  'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('H', 43),
  'v1.' || repeat('I', 43), 'v1.' || repeat('J', 43), 'SCHOOL_RESEARCH',
  50, 25, 15000, 25, '2026-08-03T19:00:01Z'
);
select is(
  private.start_ai_operation((select operation_id from initial_operation), '2026-08-03T19:00:02Z'),
  'STARTED',
  'initial research starts'
);

create temp table initial_result as
select private.commit_school_dossier(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay),
  (select operation_id from initial_operation),
  jsonb_build_object(
    'schemaVersion', '1', 'summary', 'Initial evidence.',
    'sources', jsonb_build_array(jsonb_build_object(
      'category', 'ACADEMICS', 'claim', 'Initial cited claim.',
      'title', 'Initial source', 'supportingExcerpt', 'Initial supporting excerpt.',
      'normalizedUrl', 'https://umich.edu/initial',
      'retrievedAt', '2026-08-03T18:55:00Z'
    ))
  ),
  'initial-provider', 'research-model', 100, 50, 1000, 25,
  '2026-08-03T19:00:03Z'
) as data;
select is(
  (select data ->> 'essay_revision' from initial_result),
  '1',
  'initial commit returns the advanced essay revision'
);

update public.essays
set outline = '{"sections":[{"title":"Old strategy"}]}'::jsonb
where id = (select id from refresh_essay);

create temp table refresh_operation as
select operation_id from private.reserve_ai_operation(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay),
  'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('K', 43),
  'v1.' || repeat('L', 43), 'v1.' || repeat('M', 43), 'SCHOOL_RESEARCH',
  50, 25, 15000, 25, '2026-08-03T19:01:00Z'
);
select is(
  private.start_ai_operation((select operation_id from refresh_operation), '2026-08-03T19:01:01Z'),
  'STARTED',
  'refresh operation starts before provider work'
);

create temp table refresh_result as
select private.refresh_school_dossier(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay), 1,
  (select operation_id from refresh_operation),
  jsonb_build_object(
    'schemaVersion', '1', 'summary', 'Refreshed evidence.',
    'sources', jsonb_build_array(jsonb_build_object(
      'category', 'PROGRAMS', 'claim', 'Refreshed cited claim.',
      'title', 'Refreshed source', 'supportingExcerpt', 'Refreshed supporting excerpt.',
      'normalizedUrl', 'https://umich.edu/refreshed',
      'retrievedAt', '2026-08-03T19:00:30Z'
    ))
  ),
  'refresh-provider', 'research-model', 110, 55, 900, 25,
  '2026-08-03T19:01:02Z'
) as data;

select is((select data ->> 'decision' from refresh_result), 'CREATED', 'refresh commits');
select is((select data ->> 'essay_revision' from refresh_result), '2', 'refresh returns the next revision');
select is((select count(*) from public.school_dossiers), 2::bigint, 'prior dossier version is preserved');
select is(
  (select summary from public.school_dossiers where id = (select dossier_id from public.essays)),
  'Refreshed evidence.',
  'essay atomically binds the refreshed dossier'
);
select is((select outline from public.essays), null::jsonb, 'dependent outline is cleared');
select is((select revision from public.essays), 2, 'refresh advances essay revision once');
select is(
  (select status from private.ai_operations where id = (select operation_id from refresh_operation)),
  'SUCCEEDED',
  'refresh operation finalizes in the same transaction'
);
select is(
  private.refresh_school_dossier(
    'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay), 1,
    (select operation_id from refresh_operation), '{}'::jsonb,
    'changed', 'changed', 0, 0, 0, 0, '2026-08-03T19:01:03Z'
  ) ->> 'decision',
  'REPLAY',
  'same operation replays without another mutation'
);
select is((select count(*) from public.school_dossiers), 2::bigint, 'refresh replay creates no duplicate');

update public.essays
set outline = '{"sections":[{"title":"Keep me"}]}'::jsonb
where id = (select id from refresh_essay);

create temp table stale_operation as
select operation_id from private.reserve_ai_operation(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay),
  'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('N', 43),
  'v1.' || repeat('O', 43), 'v1.' || repeat('P', 43), 'SCHOOL_RESEARCH',
  50, 25, 15000, 25, '2026-08-03T19:02:00Z'
);
select is(
  private.start_ai_operation((select operation_id from stale_operation), '2026-08-03T19:02:01Z'),
  'STARTED',
  'stale refresh operation starts'
);

create temp table stale_result as
select private.refresh_school_dossier(
  'd0000000-0000-4000-8000-000000000001', (select id from refresh_essay), 1,
  (select operation_id from stale_operation),
  jsonb_build_object(
    'schemaVersion', '1', 'summary', 'Must not persist.',
    'sources', jsonb_build_array(jsonb_build_object(
      'category', 'VALUES', 'claim', 'Must not persist.',
      'title', 'Stale source', 'supportingExcerpt', 'Must not persist.',
      'normalizedUrl', 'https://umich.edu/stale',
      'retrievedAt', '2026-08-03T19:01:30Z'
    ))
  ),
  'stale-provider', 'research-model', 100, 50, 900, 25,
  '2026-08-03T19:02:02Z'
) as data;

select is((select data ->> 'decision' from stale_result), 'REVISION_MISMATCH', 'stale refresh is rejected');
select is((select count(*) from public.school_dossiers), 2::bigint, 'stale refresh persists no dossier');
select is(
  (select outline -> 'sections' -> 0 ->> 'title' from public.essays),
  'Keep me',
  'stale refresh retains dependent work'
);
select is(
  (select summary from public.school_dossiers where id = (select dossier_id from public.essays)),
  'Refreshed evidence.',
  'stale refresh retains the active dossier'
);

select * from finish();
rollback;
