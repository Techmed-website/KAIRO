-- Minimal stand-in for Supabase's auth layer so the cbt draft can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false, raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now(), email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz);
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

-- pg_net + app secrets stand-ins (HTTP calls are recorded, never sent).
create table if not exists public.app_secrets (name text primary key, value text);
create schema if not exists net;
create table if not exists net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n; select true $$;
