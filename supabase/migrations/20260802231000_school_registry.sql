create table private.schools (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  official_domain text not null,
  normalized_domain text generated always as (
    lower(trim(trailing '.' from official_domain))
  ) stored,
  verification_source_url text not null,
  verifier_id text not null,
  verified_at timestamptz not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schools_canonical_name_check check (
    char_length(canonical_name) between 1 and 200
  ),
  constraint schools_official_domain_check check (
    official_domain = lower(trim(trailing '.' from official_domain))
    and char_length(official_domain) between 3 and 253
    and official_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  constraint schools_verification_source_check check (
    verification_source_url ~ '^https://[^[:space:]]+$'
    and char_length(verification_source_url) <= 2048
  ),
  constraint schools_verifier_id_check check (
    char_length(verifier_id) between 1 and 200
  ),
  constraint schools_status_check check (status in ('ACTIVE', 'DISABLED')),
  constraint schools_timestamps_check check (
    verified_at <= updated_at and updated_at >= created_at
  ),
  constraint schools_normalized_domain_key unique (normalized_domain)
);

create index schools_active_name_id_idx
on private.schools (lower(canonical_name), id)
where status = 'ACTIVE';

create table public.school_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  url text,
  status text not null default 'PENDING',
  idempotency_key_hmac text not null,
  request_hmac text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_requests_user_id_id_key unique (user_id, id),
  constraint school_requests_name_check check (char_length(name) between 1 and 200),
  constraint school_requests_url_check check (
    url is null or (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048)
  ),
  constraint school_requests_status_check check (
    status in ('PENDING', 'APPROVED', 'REJECTED')
  ),
  constraint school_requests_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint school_requests_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint school_requests_timestamps_check check (updated_at >= created_at),
  constraint school_requests_user_idempotency_key unique (
    user_id, idempotency_key_hmac
  )
);

create index school_requests_owner_created_idx
on public.school_requests (user_id, created_at desc, id desc);

create trigger schools_set_updated_at
before update on private.schools
for each row execute function private.set_updated_at();

create trigger school_requests_set_updated_at
before update on public.school_requests
for each row execute function private.set_updated_at();

alter table private.schools enable row level security;
alter table public.school_requests enable row level security;

create policy school_requests_select_own
on public.school_requests
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table private.schools from public, anon, authenticated;
revoke all on table public.school_requests from anon, authenticated;
grant select on table public.school_requests to authenticated;
grant select, insert, update, delete on table private.schools to service_role;
grant select, insert, update, delete on table public.school_requests to service_role;

create function private.search_schools(
  requested_query text,
  requested_after_name text,
  requested_after_id uuid,
  requested_limit integer
)
returns table (id uuid, canonical_name text, official_domain text)
language sql
stable
set search_path = ''
as $$
  select schools.id, schools.canonical_name, schools.official_domain
  from private.schools schools
  where schools.status = 'ACTIVE'
    and (requested_query = '' or position(requested_query in lower(schools.canonical_name)) > 0)
    and (
      requested_after_name is null
      or (lower(schools.canonical_name), schools.id) >
        (requested_after_name, requested_after_id)
    )
  order by lower(schools.canonical_name), schools.id
  limit requested_limit;
$$;

create function private.create_school_request(
  requested_user_id uuid,
  requested_name text,
  requested_url text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_request public.school_requests%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:school-request:' || requested_user_id::text || ':' || requested_idempotency_key_hmac,
      0
    )
  );

  select * into current_request
  from public.school_requests
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;

  if found then
    if current_request.request_hmac = requested_request_hmac then
      return jsonb_build_object('decision', 'REPLAY', 'request', to_jsonb(current_request));
    end if;
    return jsonb_build_object('decision', 'IDEMPOTENCY_KEY_REUSED', 'request', null);
  end if;

  insert into public.school_requests (
    user_id, name, url, idempotency_key_hmac, request_hmac, created_at, updated_at
  ) values (
    requested_user_id, requested_name, requested_url,
    requested_idempotency_key_hmac, requested_request_hmac,
    requested_at, requested_at
  )
  returning * into current_request;

  return jsonb_build_object('decision', 'CREATED', 'request', to_jsonb(current_request));
end;
$$;

revoke execute on function private.search_schools(text, text, uuid, integer)
from public, anon, authenticated;
revoke execute on function private.create_school_request(uuid, text, text, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function private.search_schools(text, text, uuid, integer)
to service_role;
grant execute on function private.create_school_request(uuid, text, text, text, text, timestamptz)
to service_role;

insert into private.schools (
  canonical_name, official_domain, verification_source_url,
  verifier_id, verified_at, created_at, updated_at
)
values
  ('Brown University', 'brown.edu', 'https://www.brown.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Columbia University', 'columbia.edu', 'https://www.columbia.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Cornell University', 'cornell.edu', 'https://www.cornell.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Duke University', 'duke.edu', 'https://www.duke.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Harvard University', 'harvard.edu', 'https://www.harvard.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Massachusetts Institute of Technology', 'mit.edu', 'https://www.mit.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Northwestern University', 'northwestern.edu', 'https://www.northwestern.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Princeton University', 'princeton.edu', 'https://www.princeton.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Stanford University', 'stanford.edu', 'https://www.stanford.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('University of Chicago', 'uchicago.edu', 'https://www.uchicago.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('University of Michigan', 'umich.edu', 'https://umich.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z'),
  ('Yale University', 'yale.edu', 'https://www.yale.edu/', 'operator:launch-2026-08-02', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z', '2026-08-02T20:00:00Z');
