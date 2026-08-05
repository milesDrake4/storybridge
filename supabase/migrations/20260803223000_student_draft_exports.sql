create function private.get_student_draft_export(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with current_essay as (
    select essay.id, essay.user_id, essay.revision, essay.draft_text
    from public.essays essay
    where essay.user_id = requested_user_id
      and essay.id = requested_essay_id
  ), latest_audit as (
    select audit.status, audit.evidence_manifest_version
    from private.essay_audits audit
    join current_essay essay
      on essay.user_id = audit.user_id and essay.id = audit.essay_id
    where audit.essay_revision = essay.revision
    order by audit.created_at desc, audit.id desc
    limit 1
  )
  select case
    when not exists (select 1 from current_essay) then
      jsonb_build_object('decision', 'NOT_FOUND', 'draft_text', null)
    when exists (
      select 1 from latest_audit audit
      where audit.status = 'PASS'
        and audit.evidence_manifest_version =
          private.current_audit_evidence_manifest(
            requested_user_id, requested_essay_id
          )
    ) then
      jsonb_build_object(
        'decision', 'EXPORTABLE',
        'draft_text', (select draft_text from current_essay)
      )
    else jsonb_build_object('decision', 'BLOCKED', 'draft_text', null)
  end;
$$;

revoke execute on function private.get_student_draft_export(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.get_student_draft_export(uuid, uuid)
to service_role;
