alter table public.essays drop constraint essays_draft_text_check;
alter table public.essays add constraint essays_draft_text_check check (
  char_length(draft_text) <= 20000
  and pg_catalog.translate(draft_text, pg_catalog.chr(10), '') !~ '[[:cntrl:]]'
);

alter table private.ai_proposals add constraint ai_proposals_owner_essay_id_key
unique (user_id, essay_id, id);

create table public.essay_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  revision integer not null,
  draft_text text not null,
  origin text not null,
  accepted_proposal_id uuid,
  created_at timestamptz not null default now(),
  constraint essay_versions_owner_essay_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint essay_versions_accepted_proposal_fk
    foreign key (user_id, essay_id, accepted_proposal_id)
    references private.ai_proposals (user_id, essay_id, id) on delete cascade,
  constraint essay_versions_revision_check check (revision > 0),
  constraint essay_versions_draft_text_check check (
    char_length(draft_text) <= 20000
    and pg_catalog.translate(draft_text, pg_catalog.chr(10), '') !~ '[[:cntrl:]]'
  ),
  constraint essay_versions_origin_check check (
    origin in ('AUTOSAVE', 'ACCEPTED_PROPOSAL', 'MANUAL_SNAPSHOT')
  ),
  constraint essay_versions_proposal_origin_check check (
    (origin = 'ACCEPTED_PROPOSAL' and accepted_proposal_id is not null)
    or (origin <> 'ACCEPTED_PROPOSAL' and accepted_proposal_id is null)
  ),
  constraint essay_versions_essay_revision_key unique (essay_id, revision)
);

create index essay_versions_owner_essay_created_idx
on public.essay_versions (user_id, essay_id, created_at desc, id desc);

alter table public.essay_versions enable row level security;
create policy essay_versions_select_own on public.essay_versions
for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.essay_versions from public, anon, authenticated;
grant select on table public.essay_versions to authenticated;
grant select, insert on table public.essay_versions to service_role;

create function private.save_essay_draft(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_expected_revision integer,
  requested_draft_text text,
  requested_outline jsonb,
  requested_status text,
  requested_origin text,
  requested_accepted_proposal_id uuid,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_essay public.essays%rowtype;
  evidence_id text;
  next_draft text;
  next_outline jsonb;
  next_status text;
  next_revision integer;
  section jsonb;
  total_words integer := 0;
begin
  if requested_draft_text is null
    and requested_outline is null
    and requested_status is null
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;
  if requested_origin not in ('AUTOSAVE', 'ACCEPTED_PROPOSAL', 'MANUAL_SNAPSHOT')
    or (requested_origin = 'ACCEPTED_PROPOSAL') <> (requested_accepted_proposal_id is not null)
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;

  select * into current_essay from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'essay', null);
  end if;
  if current_essay.revision <> requested_expected_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'essay', null);
  end if;

  next_outline := coalesce(requested_outline, current_essay.outline);
  if requested_outline is not null then
    if jsonb_typeof(requested_outline) is distinct from 'object'
      or requested_outline ->> 'schemaVersion' is distinct from '1'
      or jsonb_typeof(requested_outline -> 'sections') is distinct from 'array'
      or jsonb_array_length(requested_outline -> 'sections') not between 3 and 6
      or (
        select count(distinct value ->> 'id')
        from jsonb_array_elements(requested_outline -> 'sections')
      ) <> jsonb_array_length(requested_outline -> 'sections')
      or current_essay.selected_angle_id is null
    then
      return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
    end if;
    for section in select value from jsonb_array_elements(requested_outline -> 'sections')
    loop
      total_words := total_words + (section ->> 'targetWords')::integer;
      if jsonb_typeof(section -> 'storyFactIds') is distinct from 'array'
        or jsonb_array_length(section -> 'storyFactIds') < 1
        or jsonb_typeof(section -> 'schoolSourceIds') is distinct from 'array'
        or jsonb_array_length(section -> 'schoolSourceIds') < 1
      then
        return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
      end if;
      for evidence_id in
        select value #>> '{}' from jsonb_array_elements(section -> 'storyFactIds')
      loop
        if not exists (
          select 1 from public.angle_story_facts links
          join public.story_facts facts
            on facts.user_id = links.user_id and facts.id = links.story_fact_id
          where links.user_id = requested_user_id
            and links.essay_id = requested_essay_id
            and links.angle_id = current_essay.selected_angle_id
            and links.story_fact_id = evidence_id::uuid
            and facts.verification_status = 'VERIFIED'
            and facts.suppressed_at is null
        ) then
          return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
        end if;
      end loop;
      for evidence_id in
        select value #>> '{}' from jsonb_array_elements(section -> 'schoolSourceIds')
      loop
        if not exists (
          select 1 from public.angle_school_sources links
          where links.user_id = requested_user_id
            and links.essay_id = requested_essay_id
            and links.dossier_id = current_essay.dossier_id
            and links.angle_id = current_essay.selected_angle_id
            and links.school_source_id = evidence_id::uuid
        ) then
          return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
        end if;
      end loop;
    end loop;
    if total_words < pg_catalog.ceil(current_essay.word_limit * 0.9)
      or total_words > pg_catalog.floor(current_essay.word_limit * 1.1)
    then
      return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
    end if;
  end if;

  next_draft := coalesce(requested_draft_text, current_essay.draft_text);
  if char_length(next_draft) > 20000
    or pg_catalog.translate(next_draft, pg_catalog.chr(10), '') ~ '[[:cntrl:]]'
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;
  if requested_draft_text is not null and next_outline is null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;

  next_status := coalesce(
    requested_status,
    case
      when requested_draft_text is not null or requested_outline is not null
        then 'DRAFTING'
      else current_essay.status
    end
  );
  if (next_status in ('DRAFTING', 'REVIEWING', 'COMPLETE') and next_outline is null)
    or (next_status in ('REVIEWING', 'COMPLETE') and char_length(next_draft) = 0)
    or (current_essay.status || '>' || next_status) not in (
      'STRATEGY>STRATEGY',
      'OUTLINING>OUTLINING', 'OUTLINING>DRAFTING',
      'DRAFTING>DRAFTING', 'DRAFTING>REVIEWING',
      'REVIEWING>DRAFTING', 'REVIEWING>REVIEWING', 'REVIEWING>COMPLETE',
      'COMPLETE>DRAFTING', 'COMPLETE>COMPLETE'
    )
    or (next_status = 'COMPLETE' and requested_draft_text is not null)
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;

  if next_draft = current_essay.draft_text
    and next_outline is not distinct from current_essay.outline
    and next_status = current_essay.status
  then
    return jsonb_build_object(
      'decision', 'UNCHANGED', 'essay', to_jsonb(current_essay)
    );
  end if;

  next_revision := current_essay.revision + 1;
  update public.essays set
    draft_text = next_draft,
    outline = next_outline,
    status = next_status,
    revision = next_revision,
    updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id
  returning * into current_essay;

  if requested_draft_text is not null or requested_status is not null then
    insert into public.essay_versions (
      user_id, essay_id, revision, draft_text, origin,
      accepted_proposal_id, created_at
    ) values (
      requested_user_id, requested_essay_id, next_revision, next_draft,
      requested_origin, requested_accepted_proposal_id, requested_at
    );
  end if;
  return jsonb_build_object('decision', 'UPDATED', 'essay', to_jsonb(current_essay));
end;
$$;

revoke execute on function private.save_essay_draft(
  uuid, uuid, integer, text, jsonb, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function private.save_essay_draft(
  uuid, uuid, integer, text, jsonb, text, text, uuid, timestamptz
) to service_role;
