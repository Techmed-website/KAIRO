-- Study planner data that follows the student (website dashboard <-> KAIRO home).
-- One row per user holding the planner's own JSON (plan input, completed topic keys, notes, current week).
-- RLS on, no table policies: the only way in or out is through the two functions below, which touch
-- the caller's own row only. Nothing is ever deleted; "start over" simply saves an empty plan.

create table if not exists cbt.study_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
  updated_at timestamptz not null default now()
);
alter table cbt.study_plans enable row level security;
revoke all on cbt.study_plans from anon, authenticated;

create or replace function cbt.get_study_plan()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select case when auth.uid() is null then null
    else (select jsonb_build_object('data', p.data, 'updated_at', p.updated_at) from cbt.study_plans p where p.user_id = auth.uid()) end $$;

create or replace function cbt.save_study_plan(p_data jsonb)
returns timestamptz language plpgsql security definer set search_path = cbt, pg_temp as $$
declare v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'plan must be a JSON object' using errcode = '22023'; end if;
  insert into cbt.study_plans (user_id, data, updated_at) values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at
  returning updated_at into v_at;
  return v_at;
end $$;

revoke execute on function cbt.get_study_plan() from public, anon;
revoke execute on function cbt.save_study_plan(jsonb) from public, anon;
grant execute on function cbt.get_study_plan() to authenticated;
grant execute on function cbt.save_study_plan(jsonb) to authenticated;
