begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select has_function(
  'private',
  'rls_auto_enable',
  array[]::text[],
  'automatic RLS guard uses a non-exposed function'
);

select ok(
  to_regprocedure('public.rls_auto_enable()') is null,
  'automatic RLS guard is not exposed through the public schema'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.rls_auto_enable()',
    'EXECUTE'
  ),
  'anonymous users cannot execute the automatic RLS guard'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.rls_auto_enable()',
    'EXECUTE'
  ),
  'authenticated users cannot execute the automatic RLS guard'
);

create table public.rls_auto_enable_probe (id bigint primary key);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.rls_auto_enable_probe'::regclass
  ),
  'new public tables automatically have RLS enabled'
);

select * from finish();
rollback;
