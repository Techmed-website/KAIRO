-- Question bank import support.
-- 1. Two columns that carry the normaliser's checks (tools/question-import/normalize.py) into the
--    review queue: import_status (ready / ai_key / needs_review / needs_key) and import_flags.
-- 2. A TEMPORARY import function, protected by a one-time secret whose SHA-256 hash is stored in a
--    table only service_role can read. It is dropped by 20261118020000_drop_cbt_import_function.sql
--    straight after the import. It only inserts or updates DRAFT questions; published ones are never touched.

alter table cbt.questions
  add column import_status text,
  add column import_flags  text[] not null default '{}',
  add column image_file    text;     -- source image file name until the image is hosted (then media_url is set)

create table cbt.import_secret (sha256 text primary key);
alter table cbt.import_secret enable row level security;   -- no policies: only service_role/owner can read
insert into cbt.import_secret values ('c980065fa9dec7eb131f5796418337655aafa1d796924336ded2084ef02a6406');

create or replace function public.cbt_import_questions(p_token text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, public, pg_temp as $$
declare
  r jsonb; v_passage uuid; v_q uuid; v_subject smallint;
  n_q int := 0; n_k int := 0; n_skip int := 0;
begin
  if not exists (select 1 from cbt.import_secret
                 where sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'batch too large'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_subject from cbt.subjects where code = r ->> 'subject';
    v_passage := null;
    if r -> 'passage' is not null and jsonb_typeof(r -> 'passage') = 'object' then
      insert into cbt.passages (source_ref, html) values (r -> 'passage' ->> 'key', r -> 'passage' ->> 'html')
      on conflict (source_ref) do update set html = excluded.html
      returning id into v_passage;
    end if;

    insert into cbt.questions (source_ref, legacy_id, subject_id, year, source, stem, stem_html, passage_id,
                               options, content_hash, import_status, import_flags, image_file)
    values (r ->> 'source_ref', r ->> 'legacy_id', v_subject, (r ->> 'year')::smallint, 'jamb',
            r ->> 'stem', r ->> 'stem_html', v_passage, r -> 'options', r ->> 'content_hash',
            r ->> 'import_status', array(select jsonb_array_elements_text(coalesce(r -> 'flags', '[]'))),
            r ->> 'image_file')
    on conflict (source_ref) do update set
      legacy_id = excluded.legacy_id, subject_id = excluded.subject_id, year = excluded.year,
      stem = excluded.stem, stem_html = excluded.stem_html, passage_id = excluded.passage_id,
      options = excluded.options, content_hash = excluded.content_hash,
      import_status = excluded.import_status, import_flags = excluded.import_flags,
      image_file = excluded.image_file
      where cbt.questions.status = 'draft'
    returning id into v_q;

    if v_q is null then n_skip := n_skip + 1; continue; end if;   -- already published: left alone
    n_q := n_q + 1;

    if r ->> 'correct' is not null then
      insert into cbt.question_keys (question_id, correct_option, key_source)
      values (v_q, r ->> 'correct', r ->> 'key_source')
      on conflict (question_id) do update set correct_option = excluded.correct_option, key_source = excluded.key_source
        where cbt.question_keys.key_source <> 'editor';   -- never overwrite an editor-confirmed key
      n_k := n_k + 1;
    end if;
  end loop;
  return jsonb_build_object('questions', n_q, 'keys', n_k, 'skipped_published', n_skip);
end $$;

revoke execute on function public.cbt_import_questions(text, jsonb) from public;
grant execute on function public.cbt_import_questions(text, jsonb) to anon;
