begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function(
  'private', 'get_student_draft_export', array['uuid','uuid'],
  'student draft export decision is available to the service'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.get_student_draft_export(uuid,uuid)', 'EXECUTE'
  ),
  'browser roles cannot call the private export function'
);
select ok(
  has_function_privilege(
    'service_role', 'private.get_student_draft_export(uuid,uuid)', 'EXECUTE'
  ),
  'the service role can request an export decision'
);

insert into auth.users (id, email) values
  ('ee000000-0000-4000-8000-000000000001', 'export-owner@example.test'),
  ('ee000000-0000-4000-8000-000000000002', 'export-other@example.test');
insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit,
  status, draft_text, revision
) values (
  'ee100000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe how you will contribute to this campus community.',
  300, 'REVIEWING', 'Only the student draft may leave the service.', 4
);

select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'decision',
  'BLOCKED', 'an essay without a current passing audit cannot be exported'
);

insert into private.essay_audits (
  id, user_id, essay_id, essay_revision, issues,
  evidence_manifest_version, similarity, status,
  idempotency_key_hmac, request_hmac, created_at
) values (
  'ee200000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001', 4, '[]'::jsonb,
  private.current_audit_evidence_manifest(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ), '{}'::jsonb, 'PASS',
  'v1.' || repeat('a', 43), 'v1.' || repeat('b', 43),
  '2026-08-04T20:00:00Z'
);

select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'decision',
  'EXPORTABLE', 'a current passing audit permits export'
);
select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'draft_text',
  'Only the student draft may leave the service.',
  'the export contains exactly the editable student draft'
);
select is(
  (select count(*) from jsonb_object_keys(private.get_student_draft_export(
      'ee000000-0000-4000-8000-000000000001',
      'ee100000-0000-4000-8000-000000000001'
  ))),
  2::bigint, 'the export decision exposes no reference or audit metadata'
);
select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000002',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'decision',
  'NOT_FOUND', 'another user cannot discover or export the essay'
);

update public.essays
set draft_text = 'A newer student revision.', revision = 5
where id = 'ee100000-0000-4000-8000-000000000001';
select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'decision',
  'BLOCKED', 'editing the draft makes the prior audit stale'
);

insert into private.essay_audits (
  id, user_id, essay_id, essay_revision, issues,
  evidence_manifest_version, similarity, status,
  idempotency_key_hmac, request_hmac, created_at
) values
(
  'ee200000-0000-4000-8000-000000000002',
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001', 5, '[]'::jsonb,
  private.current_audit_evidence_manifest(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ), '{}'::jsonb, 'PASS',
  'v1.' || repeat('c', 43), 'v1.' || repeat('d', 43),
  '2026-08-04T20:01:00Z'
),
(
  'ee200000-0000-4000-8000-000000000003',
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001', 5,
  '[{"code":"EVIDENCE_MISSING","evidenceIds":[],"message":"Missing evidence","severity":"BLOCKING"}]'::jsonb,
  private.current_audit_evidence_manifest(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ), '{}'::jsonb, 'BLOCKED',
  'v1.' || repeat('e', 43), 'v1.' || repeat('f', 43),
  '2026-08-04T20:02:00Z'
);
select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001'
  ) ->> 'decision',
  'BLOCKED', 'a newer blocked audit supersedes an earlier passing audit'
);

select is(
  private.get_student_draft_export(
    'ee000000-0000-4000-8000-000000000099',
    'ee100000-0000-4000-8000-000000000099'
  ) ->> 'draft_text',
  null, 'missing exports never include a draft body'
);

select * from finish();
rollback;
