-- Minimal stand-in for Supabase's auth layer so the cbt draft can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
$$ select jsonb_build_object('sub', auth.uid(), 'email', current_setting('request.jwt.claim.email', true),
                              'is_anonymous', nullif(current_setting('request.jwt.claim.is_anonymous', true), '')::boolean) $$;
grant usage on schema auth to anon, authenticated, service_role;
-- pg_cron stand-in: records schedules instead of running them.
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
$$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command; select 1::bigint $$;

-- pgcrypto lives in the extensions schema on Supabase.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
