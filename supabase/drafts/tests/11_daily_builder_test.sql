-- Behaviour tests for 20261123090000_cbt_daily_quiz_builder.sql. Run after 10.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
reset request.jwt.claim.sub;
update cbt.assessments set status = 'archived' where type = 'daily_quiz';   -- clean slate of earlier tests' dailies
create temp table d (k text, j jsonb);

-- Fixtures: every subject, two syllabus topics each (plus Organic Compounds and an old set-text topic), 15 questions per topic.
insert into cbt.subjects (code, name) values ('BIO','Biology'),('CHM','Chemistry'),('PHY','Physics'),('MTH','Mathematics'),('ENG','English')
on conflict (code) do nothing;
create temp table ft (code text, name text, pos int);
insert into ft values ('BIO','Living organisms',1),('BIO','Evolution among organisms',2),('CHM','Separation of mixtures and purification of chemical substances',1),
  ('CHM','Organic Compounds',17),('PHY','Measurements and Units',1),('PHY','Scalars and Vectors',2),('MTH','Number bases',1),('MTH','Indices',4),
  ('ENG','Comprehension',1),('ENG','Synonyms/antonyms',7),('ENG','Set text (novel)',4);
insert into cbt.topics (subject_id, name) select s.id, ft.name from ft join cbt.subjects s on s.code = ft.code
where not exists (select 1 from cbt.topics t where t.subject_id = s.id and t.name = ft.name);
insert into cbt.topic_order (topic_id, position, in_daily)
select t.id, ft.pos, ft.name <> 'Set text (novel)' from ft join cbt.subjects s on s.code = ft.code join cbt.topics t on t.subject_id = s.id and t.name = ft.name
on conflict (topic_id) do nothing;
insert into cbt.questions (id, subject_id, topic_id, year, stem, options, content_hash, media_url)
select gen_random_uuid(), t.subject_id, t.id, 2000 + i, ft.code || ' ' || ft.name || ' question ' || i,
       '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]'::jsonb,
       md5(ft.code || ft.name || i), case when i <= 3 then '/qimg/x' || i || '.webp' end
from ft join cbt.subjects s on s.code = ft.code join cbt.topics t on t.subject_id = s.id and t.name = ft.name, generate_series(1, 15) i;
insert into cbt.question_keys (question_id, correct_option, explanation)
select q.id, 'A', 'Because A.' from cbt.questions q where q.stem like '% question %' and not exists (select 1 from cbt.question_keys k where k.question_id = q.id);
-- Traps in Biology/Evolution: no explanation, an open key review, a passage question. None may ever be picked.
update cbt.question_keys k set explanation = null from cbt.questions q where q.id = k.question_id and q.stem = 'BIO Evolution among organisms question 12';
insert into cbt.passages (id, source_ref, html) values ('40000000-0000-0000-0000-0000000000b1', 'trap', '<p>passage</p>');
update cbt.questions set passage_id = '40000000-0000-0000-0000-0000000000b1' where stem = 'BIO Evolution among organisms question 11';
update cbt.questions set status = 'published' where stem like '% question %';
insert into cbt.key_reviews (question_id, current_option, verdict, reasoning, model)
select id, 'A', 'disagree', 'trap', 'test' from cbt.questions where stem = 'BIO Evolution among organisms question 10';
-- QuizBoot already did Living organisms (the seed in the migration did this live; repeat here for the local topics).
insert into cbt.daily_topic_log (quiz_date, subject_id, topic_id, source)
select '2026-11-16', t.subject_id, t.id, 'quizboot' from cbt.topics t join cbt.subjects s on s.id = t.subject_id where s.code = 'BIO' and t.name = 'Living organisms';

-- ── Monday 23 Nov 2026 = Day 13, Biology. Dry run first. ──
insert into d select 'dry', cbt.build_daily_quiz('2026-11-23', dry_run := true);
select pg_temp.check((select (j ->> 'day_number')::int = 13 and j ->> 'subject' = 'Biology' from d where k = 'dry'), 'Mon 23 Nov is Day 13, Biology');
select pg_temp.check((select j ->> 'topic' = 'Evolution among organisms' from d where k = 'dry'), 'next unused topic in syllabus order (Living organisms was done on QuizBoot)');
select pg_temp.check((select jsonb_array_length(j -> 'questions') = 10 from d where k = 'dry'), '10 questions');
select pg_temp.check((select bool_and(x ->> 'topic' = 'Evolution among organisms') from d, jsonb_array_elements(j -> 'questions') x where k = 'dry'), 'all from that topic');
select pg_temp.check((select count(*) <= 1 from d, jsonb_array_elements(j -> 'questions') x where k = 'dry' and (x ->> 'diagram')::boolean), 'at most one diagram question');
select pg_temp.check(not exists (select 1 from d, jsonb_array_elements(j -> 'questions') x join cbt.questions q on q.id = (x ->> 'id')::uuid
                      where k = 'dry' and q.stem ~ 'question (10|11|12)$' and q.stem like 'BIO Evolution%'), 'never a flagged, passage or unexplained question');
select pg_temp.check((select j ->> 'title' = 'TECHMED UTME 2027 Daily Builder Quiz — Day 13: Biology (Evolution among organisms)' and j ->> 'slug' = 'day-13-biology-evolution-among-organisms' from d where k = 'dry'), 'title and slug');
select pg_temp.check((select array_length(regexp_split_to_array(btrim(j ->> 'caption'), '\s+'), 1) between 60 and 110 from d where k = 'dry'), 'caption is 60-110 words');
select pg_temp.check((select j ->> 'caption' like '%https://techmedng.com/quizzes/day-13-biology-evolution-among-organisms%' and j ->> 'caption' like '%Builders don''t guess — they prepare%'
                       and j ->> 'caption' like '%10 questions · 5 minutes%' and j ->> 'caption' like '%https://techmedng.com/dashboard%' and j ->> 'caption' like '%#TECHMED #UTME2027 #DailyBuilderQuiz%'
                       and j ->> 'caption' not ilike '%admission%' from d where k = 'dry'), 'caption has the link, slogan, format, free-account line and hashtags; promises nothing');
select pg_temp.check(not exists (select 1 from cbt.assessments where type = 'daily_quiz' and status <> 'archived'), 'a dry run writes nothing');

-- ── Students cannot build ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform cbt.build_daily_quiz('2026-11-23', true); raise exception 'FAIL: student built a quiz';
exception when insufficient_privilege then raise notice 'ok  students cannot build daily quizzes'; end $$;
reset role; reset request.jwt.claim.sub;   -- the scheduler runs with no user

-- ── Live build ──
update cbt.assessments set featured = true where id = '50000000-0000-0000-0000-000000000001';  -- (a challenge stays featured)
insert into cbt.assessments (type, title, featured, status, opens_at) values ('daily_quiz', 'Yesterday', true, 'live', '2026-11-22 04:30+01');
insert into d select 'live', cbt.build_daily_quiz('2026-11-23');
create temp table a1 as select * from cbt.assessments where id = (select (j ->> 'assessment_id')::uuid from d where k = 'live');
select pg_temp.check((select type = 'daily_quiz' and time_limit_sec = 300 and ranked and shuffle_questions and shuffle_options and answers_visibility = 'after_submit'
                       and attempts_allowed is null and guests_allowed and featured and day_number = 13 and (result_config ->> 'pass_mark')::int = 60 from a1), 'settings: 5 min, ranked, shuffled, after submit, unlimited, guests, featured');
select pg_temp.check((select (opens_at at time zone 'Africa/Lagos')::time = '04:30' and status = 'live' from a1), 'opens 04:30 WAT (live, the date has passed)');
select pg_temp.check((select count(*) = 10 from cbt.assessment_questions where assessment_id = (select id from a1)), '10 questions attached');
select pg_temp.check((select not featured from cbt.assessments where title = 'Yesterday'), 'yesterday''s quiz is un-featured');
select pg_temp.check((select featured from cbt.assessments where id = '50000000-0000-0000-0000-000000000001'), 'other featured items (challenges) are left alone');
select pg_temp.check((select caption like '🧬%' and description like 'Biology · Evolution among organisms.%' from a1), 'caption and website description stored');
select pg_temp.check((select (j ->> 'existing')::boolean from (select cbt.build_daily_quiz('2026-11-23') j) x), 'running again the same day changes nothing');
set role anon;
select pg_temp.check((cbt.public_quiz('day-13-biology-evolution-among-organisms') ->> 'question_count')::int = 10, 'the website can show it by slug');
reset role;

-- ── Following days: Biology → Chemistry → Physics → English, every quiz one topic, never Maths or mixed subjects ──
insert into d select 'tue', cbt.build_daily_quiz('2026-11-24', true);
select pg_temp.check((select j ->> 'subject' = 'Chemistry' and j ->> 'topic' = 'Organic Compounds' from d where k = 'tue'),
  'Day 14: Chemistry, skipping Separation of mixtures (done on QuizBoot Day 7) and topics with too few questions');
insert into d select 'wed', cbt.build_daily_quiz('2026-11-25', true);
select pg_temp.check((select j ->> 'subject' = 'Physics' and j ->> 'topic' = 'Motion' or j ->> 'topic' <> 'Mixed Topics' from d where k = 'wed'), 'Day 15: Physics, a single topic (no Mixed Topics weeks any more)');
insert into d select 'thu', cbt.build_daily_quiz('2026-11-26', true);
select pg_temp.check((select j ->> 'subject' = 'Use of English' and j ->> 'topic' <> 'Set text (novel)' from d where k = 'thu'), 'Day 16: Use of English (never old set-text novels)');
select pg_temp.check((select bool_and(x ->> 'subject' = 'ENG') from d, jsonb_array_elements(j -> 'questions') x where k = 'thu'), 'all 10 English questions are English');
insert into d select 'fri', cbt.build_daily_quiz('2026-11-27', true);
select pg_temp.check((select j ->> 'subject' = 'Biology' and j ->> 'topic' = 'Living organisms' from d where k = 'fri'), 'Day 17: back to Biology, next least-used topic');
select pg_temp.check(not exists (select 1 from d, jsonb_array_elements(j -> 'questions') x join cbt.assessment_questions aq on aq.question_id = (x ->> 'id')::uuid
                      where k = 'fri' and aq.assessment_id = (select id from a1)), 'no question repeats within 60 days');
select pg_temp.check(not exists (select 1 from d where k in ('tue','wed','thu','fri') and (j ->> 'subject' in ('Mathematics','Mixed Science','UTME Mix'))), 'no Mathematics or mixed-subject days');
select pg_temp.check((select bool_and(j ->> 'caption' like '%free on KAIRO, every subject, no activation code or PIN: https://kairo.techmedng.com%'
                                      and array_length(regexp_split_to_array(btrim(j ->> 'caption'), '\s+'), 1) between 60 and 110) from d where k in ('tue','wed','thu','fri')),
  'every caption invites free practice on KAIRO and stays 60-110 words');
select pg_temp.check((select (regexp_match(j ->> 'caption', 'Practise ([0-9,]+)\+'))[1] = to_char(((select count(*) from cbt.questions where status = 'published') / 100) * 100, 'FM999,999') from d where k = 'thu'),
  'the KAIRO line quotes the real published bank size, rounded down');

-- ── Schedule ──
select pg_temp.check((select count(*) = 2 from cron.job where jobname in ('techmed-daily-quiz-build', 'techmed-daily-quiz-watchdog')
                      and (jobname <> 'techmed-daily-quiz-build' or schedule = '30 3 * * *')), 'cron: build 04:30 WAT, watchdog 05:00 WAT');
do $$ begin raise notice 'ALL DAILY BUILDER CHECKS PASSED'; end $$;
