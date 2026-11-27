-- Event retention for cbt.events (data minimisation): raw product events are kept for 400 days, then removed nightly.
-- Learning records (attempts, answers) are not affected; they are not analytics events.
create or replace function cbt.prune_events()
returns integer language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare n int;
begin
  delete from cbt.events where created_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function cbt.prune_events() from public, anon, authenticated;

select cron.schedule('kairo-prune-events', '17 3 * * *', 'select cbt.prune_events()');
