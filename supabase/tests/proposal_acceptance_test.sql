begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table(
  'private', 'proposal_acceptance_transactions',
  'proposal acceptance transactions exist'
);
select has_function(
  'private', 'accept_revision_proposal',
  array['uuid','uuid','uuid','integer','text','text','text','text','timestamp with time zone'],
  'proposal acceptance is transactional'
);
select ok(
  not has_table_privilege(
    'authenticated', 'private.proposal_acceptance_transactions', 'SELECT'
  ),
  'browser roles cannot read acceptance transactions'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.accept_revision_proposal(uuid,uuid,uuid,integer,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot invoke proposal acceptance directly'
);
select is(
  private.sha256_base64url('abc'),
  'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
  'database hashes match browser SHA-256 base64url values'
);

insert into auth.users (id, email) values
  ('fa000000-0000-4000-8000-000000000001', 'accept-owner@example.test'),
  ('fa000000-0000-4000-8000-000000000002', 'accept-other@example.test');
insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit, status,
  outline, draft_text, revision
) values (
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe a community that shaped how you contribute today.',
  300, 'DRAFTING', '{"schemaVersion":"1","sections":[]}',
  'I repaired bicycles with neighbors.', 1
);
insert into private.ai_operations (
  id, user_id, essay_id, method, route, idempotency_key_hmac,
  purpose, status, completed_at, estimated_cost_cents
) values
  ('fa200000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('a',43), 'SCHOOL_RESEARCH', 'SUCCEEDED', now(), 15),
  ('fa200000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'POST', '/api/v1/essays/{essayId}/rewrite-proposals', 'v1.' || repeat('b',43), 'REWRITE', 'SUCCEEDED', now(), 15),
  ('fa200000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'POST', '/api/v1/essays/{essayId}/rewrite-proposals', 'v1.' || repeat('c',43), 'REWRITE', 'SUCCEEDED', now(), 15),
  ('fa200000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'POST', '/api/v1/essays/{essayId}/rewrite-proposals', 'v1.' || repeat('d',43), 'REWRITE', 'SUCCEEDED', now(), 15),
  ('fa200000-0000-4000-8000-000000000005', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'POST', '/api/v1/essays/{essayId}/coach-proposals', 'v1.' || repeat('e',43), 'COACHING', 'SUCCEEDED', now(), 15);
insert into public.school_dossiers (
  id, user_id, essay_id, school_id, operation_id, summary
) values (
  'fa300000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  (select school_id from public.essays where id = 'fa100000-0000-4000-8000-000000000001'),
  'fa200000-0000-4000-8000-000000000001', 'Current school evidence.'
);
update public.essays set dossier_id = 'fa300000-0000-4000-8000-000000000001'
where id = 'fa100000-0000-4000-8000-000000000001';
insert into private.ai_proposals (
  id, user_id, essay_id, operation_id, kind, target_revision,
  proposed_content, rationale, created_at, expires_at,
  selection_start, selection_end, selection_text_hash, rewrite_instruction
) values
  ('fa400000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002', 'REWRITE', 1, '{"claims":[],"proposedText":"fixed bikes","rationale":"More direct."}', 'More direct.', now(), now() + interval '1 day', 2, 19, private.sha256_base64url('repaired bicycles'), 'CLARIFY'),
  ('fa400000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000003', 'REWRITE', 2, '{"claims":[{"text":"Unsupported","status":"BLOCKING_UNSUPPORTED","storyFactIds":[],"schoolSourceIds":[]}],"proposedText":"unsupported text","rationale":"Blocked."}', 'Blocked.', now(), now() + interval '1 day', 0, 1, repeat('g',43), 'CLARIFY'),
  ('fa400000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000004', 'REWRITE', 2, '{"claims":[],"proposedText":"expired text","rationale":"Expired."}', 'Expired.', now() - interval '2 hours', now() - interval '1 hour', 0, 1, repeat('h',43), 'CLARIFY'),
  ('fa400000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000005', 'ADVICE', 2, '{"guidance":["Revise it."],"headline":"Advice"}', 'Advice only.', now(), now() + interval '1 day', null, null, null, null);

select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001', 1,
    'I repaired bicycles with neighbors.', 'I fixed bikes with neighbors.',
    'v1.' || repeat('i',43), 'v1.' || repeat('j',43), now()
  ) ->> 'decision',
  'ACCEPTED', 'a current owned rewrite is accepted'
);
select is((select revision from public.essays), 2, 'acceptance advances one revision');
select is((select draft_text from public.essays), 'I fixed bikes with neighbors.', 'acceptance applies only the proposed next draft');
select is((select count(*) from public.essay_versions), 1::bigint, 'acceptance creates one version');
select is((select origin from public.essay_versions), 'ACCEPTED_PROPOSAL', 'accepted versions have a typed origin');
select is((select status from private.ai_proposals where id = 'fa400000-0000-4000-8000-000000000001'), 'ACCEPTED', 'the proposal is marked accepted');
select is((select count(*) from private.proposal_acceptance_transactions), 1::bigint, 'one acceptance transaction is recorded');
select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001', 1,
    'I repaired bicycles with neighbors.', 'I fixed bikes with neighbors.',
    'v1.' || repeat('i',43), 'v1.' || repeat('j',43), now()
  ) ->> 'decision',
  'REPLAY', 'an identical retry replays safely'
);
select is((select count(*) from public.essay_versions), 1::bigint, 'a replay creates no duplicate version');
select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001', 1,
    'I repaired bicycles with neighbors.', 'Different request',
    'v1.' || repeat('i',43), 'v1.' || repeat('k',43), now()
  ) ->> 'decision',
  'IDEMPOTENCY_KEY_REUSED', 'idempotency key reuse is rejected'
);
select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000002', 2,
    'I fixed bikes with neighbors.', 'Unsupported replacement',
    'v1.' || repeat('l',43), 'v1.' || repeat('m',43), now()
  ) ->> 'decision',
  'PROPOSAL_NOT_ACCEPTABLE', 'blocking unsupported claims cannot be accepted'
);
select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000003', 2,
    'I fixed bikes with neighbors.', 'Expired replacement',
    'v1.' || repeat('n',43), 'v1.' || repeat('o',43), now()
  ) ->> 'decision',
  'PROPOSAL_NOT_ACCEPTABLE', 'expired proposals cannot be accepted'
);
select is(
  private.accept_revision_proposal(
    'fa000000-0000-4000-8000-000000000001',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000004', 2,
    'I fixed bikes with neighbors.', 'Advice replacement',
    'v1.' || repeat('p',43), 'v1.' || repeat('q',43), now()
  ) ->> 'decision',
  'PROPOSAL_NOT_ACCEPTABLE', 'advice proposals cannot be accepted'
);
select is((select revision from public.essays), 2, 'rejected attempts preserve the revision');
select is((select draft_text from public.essays), 'I fixed bikes with neighbors.', 'rejected attempts preserve the draft');

select * from finish();
rollback;
