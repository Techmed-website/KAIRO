-- TECHMED explanation pipeline: AI-written explanations in the TECHMED method, with every answer key re-checked.
--
-- explanation_queue(p_limit, p_subject)  questions that still need a TECHMED explanation: none at all, no per-option
--                                        "why not" lines, or the generic "Distractors represent..." filler. Never ones
--                                        a TECHMED editor wrote, and never ones with an open key review. Newest years first.
-- save_explanation(p)                    {question_id, explanation, model, expected_option} - writes the explanation (it
--                                        reaches students at once through the existing question_keys trigger). Refuses
--                                        editor-owned rows, and rows whose key changed since the explanation was written.
-- flag_key(p)                            {question_id, proposed_option|null, verdict, reasoning, model} - the AI disagrees
--                                        with the stored key, or finds the question ambiguous/broken. Nothing is changed for
--                                        students; a TECHMED editor decides (key_reviews.status).
-- All three are for the pipeline (service role) only.

alter table cbt.question_keys
  add column explanation_source text not null default 'source'
    check (explanation_source in ('source','ai_legacy','ai_techmed','editor')),
  add column explanation_model text,
  add column explained_at timestamptz;

create table cbt.key_reviews (
  id               bigint generated always as identity primary key,
  question_id      uuid not null references cbt.questions(id),
  current_option   char(1) not null,
  proposed_option  char(1) check (proposed_option in ('A','B','C','D','E')),
  verdict          text not null check (verdict in ('disagree','ambiguous','invalid')),
  reasoning        text not null check (length(reasoning) <= 4000),
  model            text not null,
  status           text not null default 'open' check (status in ('open','accepted','rejected')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create unique index key_reviews_one_open on cbt.key_reviews (question_id) where status = 'open';
alter table cbt.key_reviews enable row level security;
create policy staff_read_key_reviews on cbt.key_reviews for select to authenticated using (cbt.is_staff());
create policy staff_update_key_reviews on cbt.key_reviews for update to authenticated using (cbt.is_staff());

create or replace function cbt.explanation_queue(p_limit int default 100, p_subject text default null)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(row order by ord_year desc, ord_ref), '[]'::jsonb) from (
    select jsonb_build_object('question_id', q.id, 'subject', s.code, 'year', q.year, 'stem_html', v.stem_html,
             'passage_html', v.passage_html, 'options', v.options, 'media_url', q.media_url,
             'correct_option', k.correct_option, 'key_source', k.key_source,
             'topic', (select name from cbt.topics t where t.id = q.topic_id),
             'existing_explanation', coalesce(k.explanation_html, k.explanation)) row,
           q.year ord_year, q.source_ref ord_ref
    from cbt.questions q
    join cbt.subjects s on s.id = q.subject_id
    join cbt.question_keys k on k.question_id = q.id
    join cbt.question_versions v on v.question_id = q.id and v.version = q.version
    where q.status = 'published'
      and k.explanation_source not in ('editor', 'ai_techmed')
      and (p_subject is null or s.code = p_subject)
      and not exists (select 1 from cbt.key_reviews r where r.question_id = q.id and r.status = 'open')
      and (coalesce(k.explanation_html, k.explanation) is null
           or coalesce(k.explanation_html, k.explanation) !~ E'\\n[A-E]: '
           or coalesce(k.explanation_html, k.explanation) ~* 'Distractors represent')
    order by q.year desc nulls last, q.source_ref
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)) x;
$$;

create or replace function cbt.save_explanation(p jsonb)
returns boolean language plpgsql security definer set search_path = cbt, pg_temp as $$
declare n int;
begin
  if coalesce(length(p ->> 'explanation'), 0) < 40 then raise exception 'explanation too short' using errcode = '22023'; end if;
  if p ->> 'explanation' !~ E'\\n[A-E]: ' then raise exception 'explanation must explain the wrong options' using errcode = '22023'; end if;
  update cbt.question_keys
     set explanation = p ->> 'explanation', explanation_html = p ->> 'explanation',
         explanation_source = 'ai_techmed', explanation_model = p ->> 'model', explained_at = now()
   where question_id = (p ->> 'question_id')::uuid and explanation_source <> 'editor'
     and (p ->> 'expected_option' is null or correct_option = p ->> 'expected_option');
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function cbt.flag_key(p jsonb)
returns boolean language plpgsql security definer set search_path = cbt, pg_temp as $$
begin
  insert into cbt.key_reviews (question_id, current_option, proposed_option, verdict, reasoning, model)
  select k.question_id, k.correct_option, nullif(p ->> 'proposed_option', ''), p ->> 'verdict', p ->> 'reasoning', p ->> 'model'
  from cbt.question_keys k where k.question_id = (p ->> 'question_id')::uuid
  on conflict (question_id) where status = 'open' do nothing;
  return found;
end $$;

revoke execute on function cbt.explanation_queue(int, text), cbt.save_explanation(jsonb), cbt.flag_key(jsonb) from public, authenticated;
grant execute on function cbt.explanation_queue(int, text), cbt.save_explanation(jsonb), cbt.flag_key(jsonb) to service_role;
grant select, update on cbt.key_reviews to authenticated;
grant all on cbt.key_reviews to service_role;
