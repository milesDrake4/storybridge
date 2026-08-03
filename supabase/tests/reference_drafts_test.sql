begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('private', 'proposal_claims', 'proposal claims exist');
select has_table(
  'private', 'proposal_claim_story_facts',
  'proposal claim fact links exist'
);
select has_table(
  'private', 'proposal_claim_school_sources',
  'proposal claim school-source links exist'
);
select has_function(
  'private', 'commit_reference_draft_proposal',
  array[
    'uuid','uuid','integer','uuid','text','jsonb','text','text',
    'integer','integer','integer','integer','timestamp with time zone'
  ],
  'reference drafts commit transactionally'
);
select ok(
  not has_table_privilege('authenticated', 'private.proposal_claims', 'SELECT'),
  'browser roles cannot read private claim manifests directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.commit_reference_draft_proposal(uuid,uuid,integer,uuid,text,jsonb,text,text,integer,integer,integer,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot commit reference drafts'
);

insert into auth.users (id, email) values
  ('ee000000-0000-4000-8000-000000000001', 'reference-owner@example.test');

insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit, status, revision
) values (
  'ee100000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe how you will contribute to this campus community.',
  300, 'DRAFTING', 7
);

insert into private.ai_operations (
  id, user_id, essay_id, method, route, idempotency_key_hmac,
  purpose, status, provider_started_at, completed_at, estimated_cost_cents
) values
  (
    'ee200000-0000-4000-8000-000000000001',
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001', 'POST',
    '/api/v1/essays/{essayId}/research', 'v1.' || repeat('a', 43),
    'SCHOOL_RESEARCH', 'SUCCEEDED', now(), now(), 15
  ),
  (
    'ee200000-0000-4000-8000-000000000002',
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001', 'POST',
    '/api/v1/essays/{essayId}/angles', 'v1.' || repeat('b', 43),
    'ANGLE_GENERATION', 'SUCCEEDED', now(), now(), 15
  ),
  (
    'ee200000-0000-4000-8000-000000000003',
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001', 'POST',
    '/api/v1/essays/{essayId}/reference-draft', 'v1.' || repeat('c', 43),
    'REFERENCE_DRAFT', 'STARTED', now(), null, 30
  );

insert into public.school_dossiers (
  id, user_id, essay_id, school_id, operation_id, summary
) values (
  'ee300000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001',
  (select school_id from public.essays where id = 'ee100000-0000-4000-8000-000000000001'),
  'ee200000-0000-4000-8000-000000000001', 'Current school evidence.'
);
insert into public.school_dossier_sources (
  id, user_id, dossier_id, category, claim, title,
  supporting_excerpt, normalized_url, retrieved_at
) values (
  'ee400000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'ee300000-0000-4000-8000-000000000001', 'COMMUNITY',
  'The school supports partnerships.', 'Community partnerships',
  'Community partnerships are supported.',
  'https://umich.edu/community', now()
);
update public.essays
set dossier_id = 'ee300000-0000-4000-8000-000000000001'
where id = 'ee100000-0000-4000-8000-000000000001';

insert into public.essay_angles (
  id, user_id, essay_id, dossier_id, operation_id, position,
  title, thesis, prompt_fit, risk, selected_at
) values (
  'ee500000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001',
  'ee300000-0000-4000-8000-000000000001',
  'ee200000-0000-4000-8000-000000000002', 1,
  'Community repair', 'Repair builds partnership.',
  'It addresses contribution.', 'Avoid generic language.', now()
);
update public.essays
set selected_angle_id = 'ee500000-0000-4000-8000-000000000001',
    outline = jsonb_build_object(
      'schemaVersion', '1',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'id', 'ee600000-0000-4000-8000-000000000001',
          'purpose', 'Open with community repair.', 'targetWords', 100,
          'storyFactIds', jsonb_build_array(),
          'schoolSourceIds', jsonb_build_array('ee400000-0000-4000-8000-000000000001')
        ),
        jsonb_build_object(
          'id', 'ee600000-0000-4000-8000-000000000002',
          'purpose', 'Connect the lesson.', 'targetWords', 100,
          'storyFactIds', jsonb_build_array(),
          'schoolSourceIds', jsonb_build_array('ee400000-0000-4000-8000-000000000001')
        ),
        jsonb_build_object(
          'id', 'ee600000-0000-4000-8000-000000000003',
          'purpose', 'Close with contribution.', 'targetWords', 100,
          'storyFactIds', jsonb_build_array(),
          'schoolSourceIds', jsonb_build_array('ee400000-0000-4000-8000-000000000001')
        )
      )
    )
where id = 'ee100000-0000-4000-8000-000000000001';

create temp table committed_reference as
select private.commit_reference_draft_proposal(
  'ee000000-0000-4000-8000-000000000001',
  'ee100000-0000-4000-8000-000000000001', 7,
  'ee200000-0000-4000-8000-000000000003',
  'reference-draft-2026-08-02',
  jsonb_build_object(
    'referenceText', 'The school supports partnerships.',
    'rationale', 'A source-grounded reference.',
    'claims', jsonb_build_array(jsonb_build_object(
      'text', 'The school supports partnerships.',
      'start', 0, 'end', 33,
      'contentHmac', 'v1.' || repeat('d', 43),
      'storyFactIds', jsonb_build_array(),
      'schoolSourceIds', jsonb_build_array('ee400000-0000-4000-8000-000000000001')
    ))
  ),
  'response-reference', 'gpt-reference', 100, 50, 20, 30, now()
) as value;

select is(
  (select value ->> 'decision' from committed_reference),
  'CREATED', 'a valid reference draft is committed'
);
select is(
  (select kind from private.ai_proposals),
  'REFERENCE_DRAFT', 'reference proposal kind is immutable and typed'
);
select is(
  (select acknowledgment_version from private.ai_proposals),
  'reference-draft-2026-08-02', 'the acknowledgment version is persisted'
);
select is(
  (select status from private.ai_proposals),
  'PENDING', 'reference proposal is not accepted'
);
select is(
  (select count(*) from private.proposal_claims),
  1::bigint, 'one normalized claim is persisted'
);
select is(
  (select count(*) from private.proposal_claim_story_facts),
  0::bigint, 'the claim contains no invented student-fact links'
);
select is(
  (select count(*) from private.proposal_claim_school_sources),
  1::bigint, 'the claim links to current school evidence'
);
select is(
  (select status from private.ai_operations where id = 'ee200000-0000-4000-8000-000000000003'),
  'SUCCEEDED', 'proposal and operation finalize together'
);
select is(
  (select result_resource_type from private.ai_operations where id = 'ee200000-0000-4000-8000-000000000003'),
  'REFERENCE_DRAFT_PROPOSAL', 'the immutable result is replay-addressable'
);
select is(
  private.commit_reference_draft_proposal(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001', 7,
    'ee200000-0000-4000-8000-000000000003',
    'reference-draft-2026-08-02', '{}'::jsonb,
    'response-reference', 'gpt-reference', 100, 50, 20, 30, now()
  ) ->> 'decision',
  'REPLAY', 'the same operation replays without duplicating claims'
);
select is(
  (select count(*) from private.proposal_claims),
  1::bigint, 'a replay creates no duplicate claim'
);
select is(
  private.accept_revision_proposal(
    'ee000000-0000-4000-8000-000000000001',
    'ee100000-0000-4000-8000-000000000001',
    (select id from private.ai_proposals), 7, '', 'Forbidden insertion',
    'v1.' || repeat('e', 43), 'v1.' || repeat('f', 43), now()
  ) ->> 'decision',
  'PROPOSAL_NOT_ACCEPTABLE', 'reference drafts cannot enter the acceptance path'
);
select is(
  (select count(*) from public.essay_versions),
  0::bigint, 'reference generation never creates a student draft version'
);

select * from finish();
rollback;
