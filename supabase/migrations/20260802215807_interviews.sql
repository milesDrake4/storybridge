create table private.interview_questions (
  position smallint primary key,
  question_key text not null unique,
  prompt text not null,
  coverage_key text not null,
  constraint interview_questions_position_check check (position between 1 and 10),
  constraint interview_questions_key_check check (
    question_key ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  constraint interview_questions_prompt_check check (char_length(prompt) between 1 and 500),
  constraint interview_questions_coverage_check check (
    coverage_key in (
      'academicInterests',
      'experiences',
      'activities',
      'responsibilities',
      'values',
      'goals',
      'voice'
    )
  )
);

insert into private.interview_questions (position, question_key, prompt, coverage_key)
values
  (1, 'ACADEMIC_INTERESTS', 'What subjects or questions keep pulling you back, even when no one assigns them?', 'academicInterests'),
  (2, 'EXPERIENCE_CHALLENGE', 'Tell me about a difficult experience that changed how you approach problems.', 'experiences'),
  (3, 'EXPERIENCE_PRIDE', 'What is an experience or accomplishment you are quietly proud of, and why?', 'experiences'),
  (4, 'ACTIVITIES', 'Where do you choose to spend time outside class, and what keeps you involved?', 'activities'),
  (5, 'RESPONSIBILITIES', 'What responsibilities do you carry at home, work, school, or in your community?', 'responsibilities'),
  (6, 'VALUES', 'Describe a moment when one of your values shaped a decision you made.', 'values'),
  (7, 'GOALS', 'What do you hope to learn, build, or contribute in the next few years?', 'goals'),
  (8, 'VOICE', 'When your writing sounds most like you, what qualities does it have?', 'voice'),
  (9, 'ADDITIONAL_CONTEXT', 'What else should an essay coach understand about you before helping with your writing?', 'experiences');

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'ACTIVE',
  coverage jsonb not null default '{"academicInterests":false,"experiences":0,"activities":false,"responsibilities":false,"values":false,"goals":false,"voice":false}'::jsonb,
  current_question_key text references private.interview_questions (question_key),
  next_sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint interview_sessions_user_id_id_key unique (user_id, id),
  constraint interview_sessions_status_check check (
    status in ('ACTIVE', 'COMPLETE')
  ),
  constraint interview_sessions_sequence_check check (next_sequence >= 0),
  constraint interview_sessions_coverage_check check (
    jsonb_typeof(coverage) = 'object'
    and jsonb_typeof(coverage -> 'academicInterests') = 'boolean'
    and jsonb_typeof(coverage -> 'experiences') = 'number'
    and (coverage ->> 'experiences')::integer between 0 and 3
    and jsonb_typeof(coverage -> 'activities') = 'boolean'
    and jsonb_typeof(coverage -> 'responsibilities') = 'boolean'
    and jsonb_typeof(coverage -> 'values') = 'boolean'
    and jsonb_typeof(coverage -> 'goals') = 'boolean'
    and jsonb_typeof(coverage -> 'voice') = 'boolean'
  ),
  constraint interview_sessions_completion_check check (
    (status = 'ACTIVE' and current_question_key is not null and completed_at is null)
    or (status = 'COMPLETE' and current_question_key is null and completed_at is not null)
  ),
  constraint interview_sessions_timestamps_check check (
    updated_at >= created_at
    and (completed_at is null or completed_at >= created_at)
  )
);

create unique index interview_sessions_one_active_user_idx
on public.interview_sessions (user_id)
where status = 'ACTIVE';

create table public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  role text not null,
  question_key text not null references private.interview_questions (question_key),
  content text not null,
  sequence integer not null,
  created_at timestamptz not null default now(),
  constraint interview_messages_user_id_id_key unique (user_id, id),
  constraint interview_messages_session_owner_fkey foreign key (user_id, session_id)
    references public.interview_sessions (user_id, id) on delete cascade,
  constraint interview_messages_role_check check (role in ('ASSISTANT', 'USER')),
  constraint interview_messages_content_check check (
    char_length(content) between 1 and 4000
  ),
  constraint interview_messages_sequence_check check (sequence >= 0),
  constraint interview_messages_session_sequence_key unique (session_id, sequence)
);

create index interview_messages_owner_session_idx
on public.interview_messages (user_id, session_id, sequence);

create trigger interview_sessions_set_updated_at
before update on public.interview_sessions
for each row execute function private.set_updated_at();

alter table private.interview_questions enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.interview_messages enable row level security;

create policy interview_sessions_select_own
on public.interview_sessions
for select to authenticated
using ((select auth.uid()) = user_id);

create policy interview_messages_select_own
on public.interview_messages
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table private.interview_questions from public, anon, authenticated;
revoke all on table public.interview_sessions from anon, authenticated;
revoke all on table public.interview_messages from anon, authenticated;
grant select on table public.interview_sessions to authenticated;
grant select on table public.interview_messages to authenticated;
grant select on table private.interview_questions to service_role;
grant select, insert, update, delete on table public.interview_sessions to service_role;
grant select, insert, update, delete on table public.interview_messages to service_role;

create function private.start_interview_session(
  requested_user_id uuid,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_session public.interview_sessions%rowtype;
  first_question private.interview_questions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storybridge:interview:' || requested_user_id::text, 0)
  );

  select * into current_session
  from public.interview_sessions
  where user_id = requested_user_id and status = 'ACTIVE'
  for update;

  if found then
    return to_jsonb(current_session);
  end if;

  select * into first_question
  from private.interview_questions
  order by position
  limit 1;

  insert into public.interview_sessions (
    user_id, current_question_key, next_sequence, created_at, updated_at
  )
  values (
    requested_user_id, first_question.question_key, 1, requested_at, requested_at
  )
  returning * into current_session;

  insert into public.interview_messages (
    user_id, session_id, role, question_key, content, sequence, created_at
  )
  values (
    requested_user_id, current_session.id, 'ASSISTANT',
    first_question.question_key, first_question.prompt, 0, requested_at
  );

  return to_jsonb(current_session);
end;
$$;

create function private.record_interview_answer(
  requested_user_id uuid,
  requested_session_id uuid,
  requested_question_key text,
  requested_answer text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  answer_message public.interview_messages%rowtype;
  current_question private.interview_questions%rowtype;
  current_session public.interview_sessions%rowtype;
  next_message public.interview_messages%rowtype;
  next_question private.interview_questions%rowtype;
  updated_coverage jsonb;
begin
  select * into current_session
  from public.interview_sessions
  where id = requested_session_id
    and user_id = requested_user_id
  for update;

  if not found then
    return null;
  end if;
  if current_session.status <> 'ACTIVE'
    or current_session.current_question_key <> requested_question_key then
    raise exception using errcode = 'P0001', message = 'interview question is out of sequence';
  end if;
  if char_length(requested_answer) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'invalid interview answer';
  end if;

  select * into current_question
  from private.interview_questions
  where question_key = requested_question_key;

  insert into public.interview_messages (
    user_id, session_id, role, question_key, content, sequence, created_at
  )
  values (
    requested_user_id, requested_session_id, 'USER', requested_question_key,
    requested_answer, current_session.next_sequence, requested_at
  )
  returning * into answer_message;

  if current_question.coverage_key = 'experiences' then
    updated_coverage := jsonb_set(
      current_session.coverage,
      '{experiences}',
      to_jsonb(least((current_session.coverage ->> 'experiences')::integer + 1, 3))
    );
  else
    updated_coverage := jsonb_set(
      current_session.coverage,
      array[current_question.coverage_key],
      'true'::jsonb
    );
  end if;

  select * into next_question
  from private.interview_questions
  where position = current_question.position + 1;

  if found then
    insert into public.interview_messages (
      user_id, session_id, role, question_key, content, sequence, created_at
    )
    values (
      requested_user_id, requested_session_id, 'ASSISTANT',
      next_question.question_key, next_question.prompt,
      current_session.next_sequence + 1, requested_at
    )
    returning * into next_message;

    update public.interview_sessions
    set
      coverage = updated_coverage,
      current_question_key = next_question.question_key,
      next_sequence = current_session.next_sequence + 2
    where id = requested_session_id
    returning * into current_session;
  else
    update public.interview_sessions
    set
      status = 'COMPLETE',
      coverage = updated_coverage,
      current_question_key = null,
      next_sequence = current_session.next_sequence + 1,
      completed_at = requested_at
    where id = requested_session_id
    returning * into current_session;
  end if;

  return jsonb_build_object(
    'session', to_jsonb(current_session),
    'answer', to_jsonb(answer_message),
    'nextQuestion', case
      when next_message.id is null then null
      else to_jsonb(next_message)
    end
  );
end;
$$;

revoke execute on function private.start_interview_session(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.start_interview_session(uuid, timestamptz)
to service_role;

revoke execute on function private.record_interview_answer(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function private.record_interview_answer(uuid, uuid, text, text, timestamptz)
to service_role;
