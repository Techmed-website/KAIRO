-- Applied 20 Nov 2026 (with the fix below). Used once: 94 pilot explanations saved; the secret is now deleted.
-- To reuse: insert a fresh sha256 into cbt.loader_secret, then run tools/explanations/load.sh.
-- Single-use loader for explanations written in outside chats (content/explanations/, checked by
-- tools/explanations/check_output.py). Saves through cbt.save_explanation, so the pipeline's rules apply
-- (TECHMED format, must explain the wrong options, editor-written explanations never overwritten, key must
-- still match). The secret is deleted after the first successful call, so the function is inert afterwards.
create table if not exists cbt.loader_secret (sha256 text primary key);
alter table cbt.loader_secret enable row level security;
insert into cbt.loader_secret values ('b2cd61d79efd696db44717714490805833535c3c98f7f67ab0444658226c3fd3');

create or replace function public.cbt_load_explanations_once(p_token text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, public, pg_temp as $$
declare r jsonb; v_q uuid; n_saved int := 0; n_skipped int := 0; n_missing int := 0;
begin
  if not exists (select 1 from cbt.loader_secret where sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_q from cbt.questions where source_ref = r ->> 'ref';
    if v_q is null then n_missing := n_missing + 1; continue; end if;
    if cbt.save_explanation(jsonb_build_object('question_id', v_q, 'explanation', r ->> 'explanation',
                                               'model', r ->> 'model', 'expected_option', r ->> 'expected_option')) then
      n_saved := n_saved + 1;
    else
      n_skipped := n_skipped + 1;
    end if;
  end loop;
  delete from cbt.loader_secret where true;   -- single use (Supabase blocks DELETE without WHERE)
  return jsonb_build_object('saved', n_saved, 'skipped', n_skipped, 'missing', n_missing);
end $$;
revoke execute on function public.cbt_load_explanations_once(text, jsonb) from public;
grant execute on function public.cbt_load_explanations_once(text, jsonb) to anon;
