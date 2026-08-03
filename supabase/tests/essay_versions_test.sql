begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select has_table('public', 'essay_versions', 'essay versions table exists');
select columns_are(
  'public', 'essay_versions',
  array['id','user_id','essay_id','revision','draft_text','origin','accepted_proposal_id','created_at'],
  'essay versions expose only the normalized snapshot columns'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.essay_versions'::regclass),
  'essay versions enforce RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.essay_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.essay_versions', 'INSERT'),
  'browser roles can read their versions but cannot create them'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.save_essay_draft(uuid,uuid,integer,text,jsonb,text,text,uuid,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot invoke draft persistence directly'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.essay_versions'::regclass
      and conname = 'essay_versions_origin_check'
      and contype = 'c'
  ),
  'version origins are constrained'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.essay_versions'::regclass
      and conname = 'essay_versions_proposal_origin_check'
      and contype = 'c'
  ),
  'accepted proposal snapshots require a proposal ID and autosaves forbid one'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.essay_versions'::regclass
      and conname = 'essay_versions_accepted_proposal_fk'
      and contype = 'f'
  ),
  'accepted proposal snapshots bind to the same owned essay'
);

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000001', 'draft-owner@example.test'),
  ('f0000000-0000-4000-8000-000000000002', 'draft-other@example.test');
insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit, status, outline, revision
) values (
  'f1000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe a community that shaped how you contribute today.',
  300, 'DRAFTING', '{"schemaVersion":"1","sections":[]}'::jsonb, 1
);

select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 1,
    E'First paragraph.\n\nSecond paragraph.', null, null, 'AUTOSAVE', null,
    '2026-08-03T22:00:00Z'
  ) ->> 'decision',
  'UPDATED', 'a current revision saves normalized plain text'
);
select is((select draft_text from public.essays), E'First paragraph.\n\nSecond paragraph.', 'paragraph breaks persist');
select is((select revision from public.essays), 2, 'a real draft change advances revision');
select is((select status from public.essays), 'DRAFTING', 'autosave preserves drafting status');
select is((select count(*) from public.essay_versions), 1::bigint, 'a real change creates one version');
select is((select origin from public.essay_versions), 'AUTOSAVE', 'autosave origin is explicit');
select is((select accepted_proposal_id from public.essay_versions), null::uuid, 'autosave has no accepted proposal');

select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 1,
    'Stale replacement', null, null, 'AUTOSAVE', null, '2026-08-03T22:00:01Z'
  ) ->> 'decision',
  'REVISION_MISMATCH', 'a stale revision is rejected'
);
select is((select draft_text from public.essays), E'First paragraph.\n\nSecond paragraph.', 'stale text never replaces newer text');
select is((select count(*) from public.essay_versions), 1::bigint, 'stale save creates no version');
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000002',
    'f1000000-0000-4000-8000-000000000001', 2,
    'Cross-owner replacement', null, null, 'AUTOSAVE', null, '2026-08-03T22:00:02Z'
  ) ->> 'decision',
  'NOT_FOUND', 'cross-owner drafts are masked as missing'
);

select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 2,
    E'First paragraph.\n\nSecond paragraph.', null, null, 'AUTOSAVE', null,
    '2026-08-03T22:00:03Z'
  ) ->> 'decision',
  'UNCHANGED', 'an identical autosave is a no-op'
);
select is((select revision from public.essays), 2, 'a no-op keeps the current revision');
select is((select count(*) from public.essay_versions), 1::bigint, 'a no-op creates no duplicate version');

select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 2,
    null, null, 'REVIEWING', 'MANUAL_SNAPSHOT', null, '2026-08-03T22:00:04Z'
  ) ->> 'decision',
  'UPDATED', 'a nonempty draft can enter review'
);
select is((select revision from public.essays), 3, 'status transition advances revision');
select is((select origin from public.essay_versions where revision = 3), 'MANUAL_SNAPSHOT', 'manual status snapshots are distinguishable');
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 3,
    'Changed while completing', null, 'COMPLETE', 'AUTOSAVE', null,
    '2026-08-03T22:00:05Z'
  ) ->> 'decision',
  'STATE_CONFLICT', 'changed text cannot skip directly to complete'
);
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 3,
    null, null, 'COMPLETE', 'MANUAL_SNAPSHOT', null, '2026-08-03T22:00:06Z'
  ) ->> 'decision',
  'UPDATED', 'reviewed unchanged text can be completed'
);
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 4,
    'A later student edit', null, null, 'AUTOSAVE', null, '2026-08-03T22:00:07Z'
  ) ->> 'decision',
  'UPDATED', 'editing a complete essay reopens drafting'
);
select is((select status from public.essays), 'DRAFTING', 'post-completion edits return to drafting');
select is((select revision from public.essays), 5, 'the reopened draft has the next revision');
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 5,
    E'bad\ttab', null, null, 'AUTOSAVE', null, '2026-08-03T22:00:08Z'
  ) ->> 'decision',
  'STATE_CONFLICT', 'unsupported control characters fail closed'
);
select is(
  private.save_essay_draft(
    'f0000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 5,
    repeat('x', 20001), null, null, 'AUTOSAVE', null, '2026-08-03T22:00:09Z'
  ) ->> 'decision',
  'STATE_CONFLICT', 'drafts over the canonical length fail closed'
);

select * from finish();
rollback;
