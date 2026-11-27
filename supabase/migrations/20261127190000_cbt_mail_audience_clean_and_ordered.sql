-- Mail audiences skip test/placeholder domains (one bad address used to fail a whole batch of 50) and go out
-- most-engaged first (KAIRO students, then most recent sign-in), so a daily sending cap reaches the warmest people first.
create or replace function cbt.mail_audience(p_audience text, p_category text, p_campaign text)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(x.j order by x.kairo desc, x.seen desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
             'user_id', u.id, 'email', lower(u.email),
             'first_name', nullif(split_part(btrim(coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
             'unsub', cbt._unsub_token(u.id, p_category), 'unsub_all', cbt._unsub_token(u.id, 'all'),
             'paid', cbt._is_paid_student(u.id), 'kairo', p.id is not null) j,
           p.id is not null kairo, u.last_sign_in_at seen
    from auth.users u left join cbt.profiles p on p.id = u.id
    where not coalesce(u.is_anonymous, false) and u.email is not null and u.email_confirmed_at is not null
      and lower(u.email) !~ '@(example\.(com|org|net)|test\.com|mailinator\.com)$' and lower(u.email) !~ '\.(test|invalid|local)$'
      and coalesce(p.role::text, 'student') = 'student'
      and cbt._email_ok(u.id, p_category)
      and not exists (select 1 from cbt.mail_log l where l.campaign = p_campaign and l.user_id = u.id and l.status = 'sent')
      and case p_audience
            when 'techmed_unpaid' then not cbt._is_paid_student(u.id)
            when 'techmed_all' then true
            when 'kairo_students' then p.id is not null
            when 'paid_students' then cbt._is_paid_student(u.id)
            else false end) x $$;
