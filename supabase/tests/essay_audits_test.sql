begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('private', 'essay_audits', 'essay audits exist');
select has_function(
  'private', 'get_essay_audit_context', array['uuid','uuid'],
  'owned audit context is available to the service'
);
select has_function(
  'private', 'commit_essay_audit',
  array[
    'uuid','uuid','uuid','integer','text','text','jsonb','jsonb','text',
    'text','text','timestamp with time zone'
  ],
  'revision-bound audits commit transactionally'
);
select ok(
  not has_table_privilege('authenticated', 'private.essay_audits', 'SELECT'),
  'browser roles cannot read private audits directly'
);
select ok(
  not has_table_privilege('service_role', 'private.essay_audits', 'UPDATE')
    and not has_table_privilege(
      'service_role', 'private.essay_audits', 'DELETE'
    ),
  'persisted audits are immutable to the application service'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.commit_essay_audit(uuid,uuid,uuid,integer,text,text,jsonb,jsonb,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot commit audits'
);

insert into auth.users (id, email) values
  ('ad000000-0000-4000-8000-000000000001', 'audit-owner@example.test');
insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit,
  status, draft_text, revision
) values (
  'ad100000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe how you will contribute to this campus community.',
  300, 'REVIEWING', 'I will contribute through careful community repair.', 4
);

create temp table audit_context as
select private.get_essay_audit_context(
  'ad000000-0000-4000-8000-000000000001',
  'ad100000-0000-4000-8000-000000000001'
) as value;

select isnt(
  (select value from audit_context), null::jsonb,
  'an owned essay returns audit context'
);
select matches(
  (select value ->> 'evidence_manifest_version' from audit_context),
  '^v1\.[A-Za-z0-9_-]{43}$',
  'the evidence snapshot has a deterministic version'
);

create temp table committed_audit as
select private.commit_essay_audit(
  'ad000000-0000-4000-8000-000000000001',
  'ad200000-0000-4000-8000-000000000001',
  'ad100000-0000-4000-8000-000000000001',
  4, 'I will contribute through careful community repair.',
  (select value ->> 'evidence_manifest_version' from audit_context),
  '[]'::jsonb,
  jsonb_build_object(
    'distinctReferenceFourGramCount', 0,
    'fourGramOverlapRatio', 0,
    'longestContiguousMatch', 0,
    'matchedReferenceFourGramCount', 0,
    'referenceTokenCount', 0,
    'studentTokenCount', 7,
    'substantiallySimilar', false,
    'thresholdCode', 'NO_REFERENCE'
  ),
  'PASS', 'v1.' || repeat('a', 43), 'v1.' || repeat('b', 43), now()
) as value;

select is(
  (select value ->> 'decision' from committed_audit),
  'CREATED', 'a valid current-revision audit is persisted'
);
select is(
  (select essay_revision from private.essay_audits),
  4, 'the persisted audit binds to the exact essay revision'
);
select is(
  private.commit_essay_audit(
    'ad000000-0000-4000-8000-000000000001',
    'ad200000-0000-4000-8000-000000000099',
    'ad100000-0000-4000-8000-000000000001',
    4, 'I will contribute through careful community repair.',
    (select value ->> 'evidence_manifest_version' from audit_context),
    '[]'::jsonb, '{}'::jsonb, 'PASS',
    'v1.' || repeat('a', 43), 'v1.' || repeat('b', 43), now()
  ) ->> 'decision',
  'REPLAY', 'the identical idempotent request replays its original audit'
);
select is(
  private.commit_essay_audit(
    'ad000000-0000-4000-8000-000000000001',
    'ad200000-0000-4000-8000-000000000099',
    'ad100000-0000-4000-8000-000000000001',
    4, 'I will contribute through careful community repair.',
    (select value ->> 'evidence_manifest_version' from audit_context),
    '[]'::jsonb, '{}'::jsonb, 'PASS',
    'v1.' || repeat('a', 43), 'v1.' || repeat('c', 43), now()
  ) ->> 'decision',
  'IDEMPOTENCY_KEY_REUSED', 'a reused key cannot change its request'
);

update public.essays
set draft_text = 'A newer student revision.', revision = 5
where id = 'ad100000-0000-4000-8000-000000000001';

select is(
  private.commit_essay_audit(
    'ad000000-0000-4000-8000-000000000001',
    'ad200000-0000-4000-8000-000000000002',
    'ad100000-0000-4000-8000-000000000001',
    4, 'I will contribute through careful community repair.',
    (select value ->> 'evidence_manifest_version' from audit_context),
    '[]'::jsonb, '{}'::jsonb, 'PASS',
    'v1.' || repeat('d', 43), 'v1.' || repeat('e', 43), now()
  ) ->> 'decision',
  'REVISION_MISMATCH', 'a draft edit rejects the stale audit calculation'
);
select isnt(
  (select essay_revision from private.essay_audits),
  (select revision from public.essays where id = 'ad100000-0000-4000-8000-000000000001'),
  'an earlier audit is non-current after any essay revision'
);
select is(
  private.commit_essay_audit(
    'ad000000-0000-4000-8000-000000000001',
    'ad200000-0000-4000-8000-000000000003',
    'ad100000-0000-4000-8000-000000000001',
    5, 'A newer student revision.', 'v1.' || repeat('z', 43),
    '[]'::jsonb, '{}'::jsonb, 'PASS',
    'v1.' || repeat('f', 43), 'v1.' || repeat('g', 43), now()
  ) ->> 'decision',
  'MANIFEST_MISMATCH', 'a stale evidence snapshot cannot be persisted'
);
select is(
  private.commit_essay_audit(
    'ad000000-0000-4000-8000-000000000099',
    'ad200000-0000-4000-8000-000000000004',
    'ad100000-0000-4000-8000-000000000001',
    5, 'A newer student revision.',
    (select value ->> 'evidence_manifest_version' from audit_context),
    '[]'::jsonb, '{}'::jsonb, 'PASS',
    'v1.' || repeat('h', 43), 'v1.' || repeat('i', 43), now()
  ) ->> 'decision',
  'NOT_FOUND', 'another owner cannot audit the essay'
);
select is(
  (select count(*) from private.essay_audits),
  1::bigint, 'failed and replayed requests create no duplicate audit'
);

select * from finish();
rollback;
