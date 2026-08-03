create table private.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  season text not null,
  essay_limit integer not null,
  status text not null default 'ACTIVE',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  stripe_checkout_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_user_id_id_key unique (user_id, id),
  constraint entitlements_kind_check check (kind in ('FREE', 'SEASON_PASS')),
  constraint entitlements_season_check check (season ~ '^[0-9]{4}-[0-9]{4}$'),
  constraint entitlements_essay_limit_check check (essay_limit between 1 and 100),
  constraint entitlements_status_check check (
    status in ('ACTIVE', 'EXPIRED', 'REFUNDED', 'REVOKED')
  ),
  constraint entitlements_window_check check (ends_at is null or ends_at > starts_at),
  constraint entitlements_timestamps_check check (updated_at >= created_at),
  constraint entitlements_user_season_kind_key unique (user_id, season, kind)
);

create index entitlements_owner_status_season_idx
on private.entitlements (user_id, status, season);
create unique index entitlements_stripe_checkout_session_idx
on private.entitlements (stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create table public.essays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school_id uuid not null references private.schools (id) on delete restrict,
  dossier_id uuid,
  season text not null,
  prompt text not null,
  word_limit integer not null,
  status text not null default 'STRATEGY',
  outline jsonb,
  draft_text text not null default '',
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essays_user_id_id_key unique (user_id, id),
  constraint essays_season_check check (season ~ '^[0-9]{4}-[0-9]{4}$'),
  constraint essays_prompt_check check (char_length(prompt) between 25 and 2000),
  constraint essays_word_limit_check check (word_limit between 25 and 1000),
  constraint essays_status_check check (
    status in ('STRATEGY', 'OUTLINING', 'DRAFTING', 'REVIEWING', 'COMPLETE')
  ),
  constraint essays_outline_check check (
    outline is null or jsonb_typeof(outline) = 'object'
  ),
  constraint essays_draft_text_check check (char_length(draft_text) <= 100000),
  constraint essays_revision_check check (revision >= 0),
  constraint essays_timestamps_check check (updated_at >= created_at)
);

create index essays_owner_updated_id_idx
on public.essays (user_id, updated_at desc, id desc);
create index essays_school_id_idx on public.essays (school_id);
create index essays_dossier_id_idx on public.essays (dossier_id)
where dossier_id is not null;

create table private.essay_allowance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement_id uuid not null,
  essay_id uuid not null unique,
  season text not null,
  idempotency_key_hmac text not null,
  request_hmac text not null,
  created_at timestamptz not null default now(),
  constraint essay_allowance_transactions_entitlement_owner_fk
    foreign key (user_id, entitlement_id)
    references private.entitlements (user_id, id)
    on delete cascade,
  constraint essay_allowance_transactions_season_check check (
    season ~ '^[0-9]{4}-[0-9]{4}$'
  ),
  constraint essay_allowance_transactions_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_allowance_transactions_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_allowance_transactions_user_idempotency_key unique (
    user_id, idempotency_key_hmac
  )
);

create index essay_allowance_transactions_entitlement_idx
on private.essay_allowance_transactions (entitlement_id, created_at, id);
create index essay_allowance_transactions_owner_season_idx
on private.essay_allowance_transactions (user_id, season, created_at, id);

create trigger entitlements_set_updated_at
before update on private.entitlements
for each row execute function private.set_updated_at();

create trigger essays_set_updated_at
before update on public.essays
for each row execute function private.set_updated_at();

alter table private.entitlements enable row level security;
alter table public.essays enable row level security;
alter table private.essay_allowance_transactions enable row level security;

create policy essays_select_own
on public.essays
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table private.entitlements from public, anon, authenticated;
revoke all on table public.essays from anon, authenticated;
revoke all on table private.essay_allowance_transactions from public, anon, authenticated;
grant select on table public.essays to authenticated;
grant select, insert, update, delete on table private.entitlements to service_role;
grant select, insert, update, delete on table public.essays to service_role;
grant select, insert, update, delete on table private.essay_allowance_transactions to service_role;

create function private.create_essay_workspace(
  requested_user_id uuid,
  requested_school_id uuid,
  requested_season text,
  requested_prompt text,
  requested_word_limit integer,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_entitlement private.entitlements%rowtype;
  current_transaction private.essay_allowance_transactions%rowtype;
  current_essay public.essays%rowtype;
  consumed_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:essay-allowance:' || requested_user_id::text || ':' || requested_season,
      0
    )
  );

  select * into current_transaction
  from private.essay_allowance_transactions
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;

  if found then
    if current_transaction.request_hmac <> requested_request_hmac then
      return jsonb_build_object('decision', 'IDEMPOTENCY_KEY_REUSED', 'essay', null);
    end if;

    select * into current_essay
    from public.essays
    where user_id = requested_user_id and id = current_transaction.essay_id;

    if found then
      return jsonb_build_object('decision', 'REPLAY', 'essay', to_jsonb(current_essay));
    end if;

    return jsonb_build_object('decision', 'REPLAY_DELETED', 'essay', null);
  end if;

  perform 1
  from private.beta_invitations
  where accepted_user_id = requested_user_id and status = 'ACCEPTED';

  if not found then
    return jsonb_build_object('decision', 'NOT_ELIGIBLE', 'essay', null);
  end if;

  perform 1
  from private.schools
  where id = requested_school_id and status = 'ACTIVE';

  if not found then
    return jsonb_build_object('decision', 'UNSUPPORTED_SCHOOL', 'essay', null);
  end if;

  insert into private.entitlements (
    user_id, kind, season, essay_limit, status, starts_at, created_at, updated_at
  ) values (
    requested_user_id, 'FREE', requested_season, 1, 'ACTIVE',
    requested_at, requested_at, requested_at
  )
  on conflict (user_id, season, kind) do nothing;

  select * into current_entitlement
  from private.entitlements
  where user_id = requested_user_id
    and season = requested_season
    and kind = 'FREE'
  for update;

  if current_entitlement.status <> 'ACTIVE'
    or (current_entitlement.ends_at is not null and current_entitlement.ends_at <= requested_at)
  then
    return jsonb_build_object('decision', 'QUOTA_EXCEEDED', 'essay', null);
  end if;

  select count(*) into consumed_count
  from private.essay_allowance_transactions
  where entitlement_id = current_entitlement.id;

  if consumed_count >= current_entitlement.essay_limit then
    return jsonb_build_object('decision', 'QUOTA_EXCEEDED', 'essay', null);
  end if;

  insert into public.essays (
    user_id, school_id, season, prompt, word_limit, created_at, updated_at
  ) values (
    requested_user_id, requested_school_id, requested_season,
    requested_prompt, requested_word_limit, requested_at, requested_at
  )
  returning * into current_essay;

  insert into private.essay_allowance_transactions (
    user_id, entitlement_id, essay_id, season,
    idempotency_key_hmac, request_hmac, created_at
  ) values (
    requested_user_id, current_entitlement.id, current_essay.id, requested_season,
    requested_idempotency_key_hmac, requested_request_hmac, requested_at
  );

  return jsonb_build_object('decision', 'CREATED', 'essay', to_jsonb(current_essay));
end;
$$;

create function private.list_essay_workspaces(
  requested_user_id uuid,
  requested_after_updated_at timestamptz,
  requested_after_id uuid,
  requested_limit integer
)
returns table (essay jsonb, school jsonb)
language sql
stable
set search_path = ''
as $$
  select
    to_jsonb(essays),
    jsonb_build_object(
      'id', schools.id,
      'canonical_name', schools.canonical_name,
      'official_domain', schools.official_domain
    )
  from public.essays essays
  join private.schools schools on schools.id = essays.school_id
  where essays.user_id = requested_user_id
    and (
      requested_after_updated_at is null
      or (essays.updated_at, essays.id) <
        (requested_after_updated_at, requested_after_id)
    )
  order by essays.updated_at desc, essays.id desc
  limit requested_limit;
$$;

create function private.get_essay_workspace(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'essay', to_jsonb(essays),
    'school', jsonb_build_object(
      'id', schools.id,
      'canonical_name', schools.canonical_name,
      'official_domain', schools.official_domain
    )
  )
  from public.essays essays
  join private.schools schools on schools.id = essays.school_id
  where essays.user_id = requested_user_id and essays.id = requested_essay_id;
$$;

create function private.delete_essay_workspace(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns boolean
language sql
set search_path = ''
as $$
  with removed as (
    delete from public.essays
    where user_id = requested_user_id and id = requested_essay_id
    returning id
  )
  select exists(select 1 from removed);
$$;

revoke execute on function private.create_essay_workspace(
  uuid, uuid, text, text, integer, text, text, timestamptz
) from public, anon, authenticated;
revoke execute on function private.list_essay_workspaces(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke execute on function private.get_essay_workspace(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.delete_essay_workspace(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.create_essay_workspace(
  uuid, uuid, text, text, integer, text, text, timestamptz
) to service_role;
grant execute on function private.list_essay_workspaces(
  uuid, timestamptz, uuid, integer
) to service_role;
grant execute on function private.get_essay_workspace(uuid, uuid) to service_role;
grant execute on function private.delete_essay_workspace(uuid, uuid) to service_role;
