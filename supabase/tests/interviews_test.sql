begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'interview_sessions', 'interview sessions table exists');
select has_table('public', 'interview_messages', 'interview messages table exists');
select has_table('private', 'interview_questions', 'server-owned question catalog exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.interview_sessions'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.interview_messages'::regclass),
  'interview data has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.interview_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.interview_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.interview_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'private.interview_questions', 'SELECT'),
  'clients cannot mutate interviews or read the catalog directly'
);
select ok(
  not has_function_privilege('authenticated', 'private.start_interview_session(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.record_interview_answer(uuid,uuid,text,text,timestamptz)', 'EXECUTE'),
  'clients cannot invoke interview mutation RPCs directly'
);

insert into auth.users (id, email)
values
  ('90000000-0000-4000-8000-000000000001', 'interview-owner@example.test'),
  ('90000000-0000-4000-8000-000000000002', 'interview-other@example.test');

create temp table started_session as
select private.start_interview_session(
  '90000000-0000-4000-8000-000000000001',
  '2026-08-02T14:00:00Z'
) as data;

select is(
  (select data ->> 'current_question_key' from started_session),
  'ACADEMIC_INTERESTS',
  'a new session starts at the first fixed question'
);
select is(
  (select count(*) from public.interview_messages),
  1::bigint,
  'starting persists the first assistant question'
);
select is(
  (
    select private.start_interview_session(
      '90000000-0000-4000-8000-000000000001',
      '2026-08-02T14:00:01Z'
    ) ->> 'id'
  ),
  (select data ->> 'id' from started_session),
  'start is idempotent while a session is active'
);
select is(
  private.record_interview_answer(
    '90000000-0000-4000-8000-000000000002',
    (select (data ->> 'id')::uuid from started_session),
    'ACADEMIC_INTERESTS',
    'Synthetic answer',
    '2026-08-02T14:00:02Z'
  ),
  null::jsonb,
  'missing and cross-user session IDs have the same result'
);
select throws_ok(
  format(
    $$select private.record_interview_answer('90000000-0000-4000-8000-000000000001', %L, 'VALUES', 'Synthetic answer', '2026-08-02T14:00:03Z')$$,
    (select data ->> 'id' from started_session)
  ),
  'P0001',
  'interview question is out of sequence',
  'out-of-order answers are rejected'
);

create temp table first_turn as
select private.record_interview_answer(
  '90000000-0000-4000-8000-000000000001',
  (select (data ->> 'id')::uuid from started_session),
  'ACADEMIC_INTERESTS',
  'Synthetic academic answer',
  '2026-08-02T14:00:04Z'
) as data;

select is(
  (select data #>> '{session,current_question_key}' from first_turn),
  'EXPERIENCE_CHALLENGE',
  'a valid answer advances to the next server-owned question'
);
select results_eq(
  $$select sequence from public.interview_messages order by sequence$$,
  $$values (0), (1), (2)$$,
  'message sequence is assigned only by the server'
);

select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'EXPERIENCE_CHALLENGE', 'Synthetic answer two', '2026-08-02T14:00:05Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'EXPERIENCE_PRIDE', 'Synthetic answer three', '2026-08-02T14:00:06Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'ACTIVITIES', 'Synthetic answer four', '2026-08-02T14:00:07Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'RESPONSIBILITIES', 'Synthetic answer five', '2026-08-02T14:00:08Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'VALUES', 'Synthetic answer six', '2026-08-02T14:00:09Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'GOALS', 'Synthetic answer seven', '2026-08-02T14:00:10Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'VOICE', 'Synthetic answer eight', '2026-08-02T14:00:11Z');
select private.record_interview_answer('90000000-0000-4000-8000-000000000001', (select (data ->> 'id')::uuid from started_session), 'ADDITIONAL_CONTEXT', 'Synthetic answer nine', '2026-08-02T14:00:12Z');

select is(
  (select status from public.interview_sessions),
  'COMPLETE',
  'the fixed interview completes after all nine answers'
);
select ok(
  (
    select
      (coverage ->> 'academicInterests')::boolean
      and (coverage ->> 'experiences')::integer >= 2
      and (coverage ->> 'activities')::boolean
      and (coverage ->> 'responsibilities')::boolean
      and (coverage ->> 'values')::boolean
      and (coverage ->> 'goals')::boolean
      and (coverage ->> 'voice')::boolean
    from public.interview_sessions
  ),
  'completion records the required coverage categories'
);
select is(
  (select count(*) from public.interview_messages),
  18::bigint,
  'the complete transcript contains nine questions and nine answers'
);

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000001';
select is((select count(*) from public.interview_messages), 18::bigint, 'the owner can resume the full transcript');
set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000002';
select is((select count(*) from public.interview_messages), 0::bigint, 'another user cannot read the transcript');
select throws_ok(
  $$insert into public.interview_messages (user_id, session_id, role, question_key, content, sequence) values ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'USER', 'ACADEMIC_INTERESTS', 'attacker', 99)$$,
  '42501',
  null,
  'direct message writes are denied'
);
reset role;

select * from finish();
rollback;
