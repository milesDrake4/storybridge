create function private.select_essay_angle(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_angle_id uuid,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_angle public.essay_angles%rowtype;
  current_essay public.essays%rowtype;
begin
  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND');
  end if;

  select * into current_angle
  from public.essay_angles
  where user_id = requested_user_id
    and essay_id = requested_essay_id
    and id = requested_angle_id
    and dossier_id = current_essay.dossier_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND');
  end if;

  if current_essay.selected_angle_id = requested_angle_id then
    return jsonb_build_object('decision', 'REPLAY');
  end if;
  if current_essay.selected_angle_id is not null then
    return jsonb_build_object('decision', 'STATE_CONFLICT');
  end if;

  update public.essay_angles
  set selected_at = requested_at, updated_at = requested_at
  where user_id = requested_user_id and id = requested_angle_id;
  update public.essays
  set selected_angle_id = requested_angle_id,
      status = 'OUTLINING',
      revision = revision + 1,
      updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id;

  return jsonb_build_object('decision', 'SELECTED');
end;
$$;

revoke execute on function private.select_essay_angle(uuid, uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.select_essay_angle(uuid, uuid, uuid, timestamptz)
to service_role;

create function private.update_essay_angle(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_angle_id uuid,
  requested_expected_revision integer,
  requested_title text,
  requested_thesis text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_essay public.essays%rowtype;
begin
  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND');
  end if;
  if current_essay.revision <> requested_expected_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH');
  end if;
  if current_essay.selected_angle_id is not null then
    return jsonb_build_object('decision', 'STATE_CONFLICT');
  end if;
  if not exists (
    select 1 from public.essay_angles angles
    where angles.user_id = requested_user_id
      and angles.essay_id = requested_essay_id
      and angles.id = requested_angle_id
      and angles.dossier_id = current_essay.dossier_id
  ) then
    return jsonb_build_object('decision', 'NOT_FOUND');
  end if;
  if exists (
    select 1 from public.essay_angles angles
    where angles.user_id = requested_user_id
      and angles.essay_id = requested_essay_id
      and angles.id <> requested_angle_id
      and lower(angles.title) = lower(requested_title)
  ) then
    return jsonb_build_object('decision', 'STATE_CONFLICT');
  end if;

  update public.essay_angles
  set title = requested_title, thesis = requested_thesis, updated_at = requested_at
  where user_id = requested_user_id and id = requested_angle_id;
  update public.essays
  set revision = revision + 1, updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id;
  return jsonb_build_object('decision', 'UPDATED');
end;
$$;

revoke execute on function private.update_essay_angle(
  uuid, uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function private.update_essay_angle(
  uuid, uuid, uuid, integer, text, text, timestamptz
) to service_role;
