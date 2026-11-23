-- Batch 3: the Daily Builder Quiz builds itself from the bank (no AI, no QuizBoot).
--
--   select cbt.build_daily_quiz();                                   -- today (Africa/Lagos), live
--   select cbt.build_daily_quiz('2026-11-24', dry_run := true);      -- the plan only, nothing written
--
-- Day N = days since 10 Nov 2026 (11 Nov = Day 1, matching the QuizBoot series). Subject by weekday:
-- Mon Biology, Tue Chemistry, Wed Physics, Thu Mathematics, Fri Use of English,
-- Sat Mixed Science (3 BIO / 4 CHM / 3 PHY), Sun UTME Mix (3 ENG / 2 BIO / 2 Organic Chemistry / 2 PHY / 1 MTH).
-- Weekdays rotate through the JAMB syllabus (cbt.topic_order): the topic used least so far, earliest in the syllabus,
-- with at least 10 usable questions. Every 3rd week the weekday quizzes are "Mixed Topics" for that subject.
-- Questions: published, with key and explanation, no open key review or report, no comprehension passage, not a
-- set-text (novel) question, not in a daily quiz in the last 60 days, at most one diagram per subject block. Hardest
-- first once a question has 5+ answers on record, otherwise random. (No difficulty ratings exist yet; none are faked.)
-- 10 questions, 5 minutes, ranked (first attempt counts), shuffled, answers after submit, guests welcome, featured.
-- pg_cron: built at 04:30 WAT; at 05:00 WAT a watchdog retries once and emails the admin if there is still no quiz.

-- ── 1. Syllabus order and the rotation log ──────────────────────────────────────────────────
create table if not exists cbt.topic_order (
  topic_id int primary key references cbt.topics(id),
  position smallint not null,
  in_daily boolean not null default true          -- false: never used for daily quizzes (e.g. old set-text novels)
);
alter table cbt.topic_order enable row level security;
create policy read_topic_order on cbt.topic_order for select using (true);
grant select on cbt.topic_order to authenticated;

insert into cbt.topic_order (topic_id, position, in_daily)
select t.id, x.pos, x.name <> 'Set text (novel)'
from (
  select 'PHY' code, n name, p pos from unnest(array[
    'Measurements and Units','Scalars and Vectors','Motion','Gravitational Field','Equilibrium of Forces','Work, Energy and Power',
    'Friction','Simple Machines','Elasticity','Pressure','Liquids at Rest','Temperature and its Measurement','Thermal Expansion',
    'Gas Laws','Quantity of Heat','Change of State','Vapours','Kinetic Theory of Matter','Heat Transfer','Waves',
    'Propagation of Sound Waves','Light Energy','Reflection of Light','Refraction of Light','Optical Instruments',
    'Dispersion of Light and Colours','Electrostatics','Capacitors','Electric Cells','Current Electricity',
    'Electrical Energy and Power','Magnetic Field','Electromagnetic Induction','Alternating Current',
    'Electrical Measuring Instruments','Elementary Modern Physics','Energy Quantization','Nuclear Physics','Semiconductors'])
    with ordinality u(n, p)
  union all select 'CHM', n, p from unnest(array[
    'Separation of mixtures and purification of chemical substances','Chemical combination','Kinetic theory of matter and Gas Laws',
    'Atomic structure and bonding','Air','Water','Solubility','Environmental Pollution','Acids, bases and salts',
    'Oxidation and reduction','Electrolysis','Energy changes','Rates of Chemical Reaction','Chemical equilibria',
    'Non-metals and their compounds','Metals and their compounds','Organic Compounds','Chemistry and Industry'])
    with ordinality u(n, p)
  union all select 'BIO', n, p from unnest(array[
    'Living organisms','Evolution among organisms','Structural/functional and behavioural adaptations of organisms',
    'Internal structure of plants and animals','Nutrition','Transport','Respiration','Excretion','Support and movement',
    'Reproduction','Growth','Co-ordination and control','Factors affecting the distribution of organisms',
    'Symbiotic interactions of plants and animals','Natural habitats','Local (Nigerian) biomes','The ecology of populations',
    'Soil','Humans and environment','Variation in population','Heredity','Theories of evolution','Evidence of evolution'])
    with ordinality u(n, p)
  union all select 'MTH', n, p from unnest(array[
    'Number bases','Fractions, decimals and approximations','Percentages','Indices','Logarithms','Surds','Sets',
    'Algebraic expressions','Factorization','Polynomials','Simultaneous equations','Quadratic equations','Inequalities',
    'Arithmetic progression','Geometric progression','Binary operations','Matrices and determinants','Triangles','Polygons',
    'Circles','Mensuration','Loci','Coordinate geometry','Trigonometric ratios','Trigonometric functions',
    'Heights and distances','Differentiation','Applications of differentiation','Integration','Applications of integration',
    'Data collection and presentation','Measures of central tendency','Measures of dispersion',
    'Permutations and combinations','Probability'])
    with ordinality u(n, p)
  union all select 'ENG', n, p from unnest(array[
    'Comprehension','Synthesis of ideas from passages','Coherence and logical reasoning','Set text (novel)','Vocabulary',
    'Vocabulary and expressions in context','Synonyms/antonyms','Idiomatic expressions','Appropriate word choice',
    'Homophones','Word classes','Sentence structure','Grammatical usage','Sentence completion','Error identification',
    'Vowels','Consonants','Rhymes','Stress','Intonation','Pronunciation distinctions'])
    with ordinality u(n, p)
) x
join cbt.subjects s on s.code = x.code
join cbt.topics t on t.subject_id = s.id and t.name = x.name
on conflict (topic_id) do nothing;

create table if not exists cbt.daily_topic_log (
  id bigint generated always as identity primary key,
  quiz_date date not null,
  subject_id smallint not null references cbt.subjects(id),
  topic_id int references cbt.topics(id),          -- null = mixed topics
  assessment_id uuid unique references cbt.assessments(id),
  source text not null default 'kairo' check (source in ('kairo', 'quizboot'))
);
create index if not exists daily_topic_log_subject on cbt.daily_topic_log (subject_id, topic_id);
alter table cbt.daily_topic_log enable row level security;
revoke all on cbt.daily_topic_log from anon, authenticated;

-- The QuizBoot series so far (Days 1–12), so KAIRO carries on where it stopped instead of starting over.
insert into cbt.daily_topic_log (quiz_date, subject_id, topic_id, source)
select x.d::date, t.subject_id, t.id, 'quizboot'
from (values ('2026-11-11','PHY','Measurements and Units'), ('2026-11-12','MTH','Number bases'),
             ('2026-11-12','MTH','Fractions, decimals and approximations'), ('2026-11-13','ENG','Comprehension'),
             ('2026-11-16','BIO','Living organisms'), ('2026-11-17','CHM','Separation of mixtures and purification of chemical substances'),
             ('2026-11-18','PHY','Scalars and Vectors'), ('2026-11-19','MTH','Indices'), ('2026-11-19','MTH','Surds'),
             ('2026-11-20','ENG','Synonyms/antonyms')) x(d, code, name)
join cbt.subjects s on s.code = x.code
join cbt.topics t on t.subject_id = s.id and t.name = x.name
where not exists (select 1 from cbt.daily_topic_log l where l.source = 'quizboot');

-- ── 2. Helpers ──────────────────────────────────────────────────────────────────────────────
create or replace function cbt.slugify(p text) returns text language sql immutable as
$$ select left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 80) $$;

create or replace function cbt.subject_label(p_code text) returns text language sql immutable as
$$ select case p_code when 'BIO' then 'Biology' when 'CHM' then 'Chemistry' when 'PHY' then 'Physics'
                      when 'MTH' then 'Mathematics' when 'ENG' then 'Use of English' else p_code end $$;

-- Questions a daily quiz on p_date may use, with how hard they have proved (share answered correctly, 5+ answers).
create or replace function cbt._daily_eligible(p_date date)
returns table (id uuid, version int, subject_code text, topic_id int, has_media boolean, correct_rate numeric)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select q.id, q.version, s.code, q.topic_id, q.media_url is not null,
         (select case when count(*) >= 5 then avg((aa.is_correct)::int) end
          from cbt.attempt_answers aa where aa.question_id = q.id and aa.selected_option is not null)
  from cbt.questions q
  join cbt.subjects s on s.id = q.subject_id
  join cbt.question_keys k on k.question_id = q.id
  left join cbt.topic_order o on o.topic_id = q.topic_id
  where q.status = 'published'
    and nullif(btrim(k.explanation), '') is not null
    and q.passage_id is null
    and coalesce(o.in_daily, true)
    and not exists (select 1 from cbt.key_reviews r where r.question_id = q.id and r.status = 'open')
    and not exists (select 1 from cbt.question_reports r where r.question_id = q.id and r.status = 'open')
    and not exists (select 1 from cbt.assessment_questions aq join cbt.assessments a on a.id = aq.assessment_id
                    where aq.question_id = q.id and a.type = 'daily_quiz' and a.status <> 'archived'
                      and (a.opens_at at time zone 'Africa/Lagos')::date > p_date - 60) $$;
revoke execute on function cbt._daily_eligible(date) from public, anon, authenticated;

-- ── 3. The builder ──────────────────────────────────────────────────────────────────────────
create or replace function cbt.build_daily_quiz(p_date date default null, dry_run boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Lagos')::date);
  v_day int := v_date - date '2026-11-10';
  v_dow int := extract(isodow from v_date)::int;
  v_mixed_week boolean := ((v_date - date '2026-11-11') / 7) % 3 = 2;
  v_existing uuid;
  v_code text; v_subject_id smallint; v_topic_id int; v_topic text;
  v_subject_label text; v_mix jsonb; v_part jsonb;
  v_ids uuid[] := '{}'; v_pick uuid[];
  v_title text; v_slug text; v_caption text; v_desc text; v_hook text;
  v_opens timestamptz := (v_date::text || ' 04:30')::timestamp at time zone 'Africa/Lagos';
  v_a uuid;
begin
  if auth.uid() is not null and not cbt.is_staff() then raise exception 'editors only' using errcode = '42501'; end if;
  if v_day < 1 then raise exception 'the Daily Builder series starts on 11 Nov 2026' using errcode = '22023'; end if;

  select id into v_existing from cbt.assessments
  where type = 'daily_quiz' and status <> 'archived' and (opens_at at time zone 'Africa/Lagos')::date = v_date;
  if v_existing is not null then
    return jsonb_build_object('date', v_date, 'day_number', v_day, 'existing', true, 'assessment_id', v_existing);
  end if;

  -- Which subjects, how many each.
  v_mix := case v_dow
    when 1 then '[{"code":"BIO","n":10}]' when 2 then '[{"code":"CHM","n":10}]' when 3 then '[{"code":"PHY","n":10}]'
    when 4 then '[{"code":"MTH","n":10}]' when 5 then '[{"code":"ENG","n":10}]'
    when 6 then '[{"code":"BIO","n":3},{"code":"CHM","n":4},{"code":"PHY","n":3}]'
    else '[{"code":"ENG","n":3},{"code":"BIO","n":2},{"code":"CHM","n":2,"organic":true},{"code":"PHY","n":2},{"code":"MTH","n":1}]' end::jsonb;

  -- Weekday topic: least used so far, then earliest in the syllabus, with enough questions left.
  if v_dow <= 5 then
    v_code := v_mix -> 0 ->> 'code';
    select id into v_subject_id from cbt.subjects where code = v_code;
    if not v_mixed_week then
      select o.topic_id, t.name into v_topic_id, v_topic
      from cbt.topic_order o join cbt.topics t on t.id = o.topic_id
      where t.subject_id = v_subject_id and o.in_daily
        and (select count(*) from cbt._daily_eligible(v_date) p where p.topic_id = o.topic_id) >= 10
      order by (select count(*) from cbt.daily_topic_log l where l.topic_id = o.topic_id), o.position
      limit 1;
    end if;
  end if;

  for v_part in select * from jsonb_array_elements(v_mix) loop
    v_pick := cbt._daily_pick(v_date, v_part ->> 'code', case when v_dow <= 5 then v_topic_id end,
                              coalesce((v_part ->> 'organic')::boolean, false), (v_part ->> 'n')::int, v_ids);
    v_ids := v_ids || v_pick;
  end loop;
  -- Short of questions (a thin topic after the 60-day rule)? Top up from the same subject(s), any topic.
  if cardinality(v_ids) < 10 then
    for v_part in select * from jsonb_array_elements(v_mix) loop
      exit when cardinality(v_ids) >= 10;
      v_ids := v_ids || cbt._daily_pick(v_date, v_part ->> 'code', null, false, 10 - cardinality(v_ids), v_ids);
    end loop;
  end if;
  if cardinality(v_ids) < 10 then
    raise exception 'only % usable questions for %', cardinality(v_ids), v_date using errcode = 'P0002';
  end if;

  -- Words.
  v_subject_label := case v_dow when 6 then 'Mixed Science' when 7 then 'UTME Mix' else cbt.subject_label(v_code) end;
  v_topic := case when v_dow = 6 then 'Biology, Chemistry & Physics'
                  when v_dow = 7 then 'English, Biology, Organic Chemistry, Physics & Maths'
                  else coalesce(v_topic, 'Mixed Topics') end;
  v_title := 'TECHMED UTME 2027 Daily Builder Quiz — Day ' || v_day || ': ' || v_subject_label || ' (' || v_topic || ')';
  v_slug := cbt.slugify('day-' || v_day || '-' || v_subject_label || '-' || v_topic);
  v_hook := case v_dow when 1 then '🧬 Biology Monday, Builders!' when 2 then '⚗️ Chemistry Tuesday is here, Builders!'
                       when 3 then '⚡ Physics Wednesday, Builders!' when 4 then '🧮 Maths Thursday: sharpen your pencils, Builders!'
                       when 5 then '📚 English Friday, Builders!' when 6 then '🔬 Mixed Science Saturday, Builders!'
                       else '🔥 Sunday UTME Mix, Builders!' end;
  v_caption := v_hook || E'\n' ||
    'Day ' || v_day || ' of the TECHMED Daily Builder Quiz is live: ' || v_subject_label || ', ' || v_topic || '.' || E'\n' ||
    'Real JAMB past questions, timed like the real thing. Builders don''t guess — they prepare.' || E'\n\n' ||
    '📝 10 questions · 5 minutes · instant explanations' || E'\n' ||
    '👉 Start here: https://techmedng.com/quizzes/' || v_slug || E'\n\n' ||
    'Done? Share your score here and challenge a friend to beat it 💪' || E'\n' ||
    'No account yet? Create your free TECHMED account: https://techmedng.com/dashboard' || E'\n\n' ||
    '#TECHMED #UTME2027 #DailyBuilderQuiz';
  v_desc := v_subject_label || ' · ' || v_topic || '. 10 JAMB past questions in 5 minutes, with an explanation for every answer. Builders don''t guess — they prepare.';

  if dry_run then
    return jsonb_build_object('dry_run', true, 'date', v_date, 'day_number', v_day, 'subject', v_subject_label,
      'topic', v_topic, 'topic_id', v_topic_id, 'mixed_topics_week', v_mixed_week and v_dow <= 5,
      'title', v_title, 'slug', v_slug, 'opens_at', v_opens, 'description', v_desc, 'caption', v_caption,
      'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'subject', s.code, 'topic', t.name,
                                                         'year', q.year, 'diagram', q.media_url is not null)
                                     order by array_position(v_ids, q.id))
                    from cbt.questions q join cbt.subjects s on s.id = q.subject_id left join cbt.topics t on t.id = q.topic_id
                    where q.id = any (v_ids)));
  end if;

  update cbt.assessments set featured = false where type = 'daily_quiz' and featured;
  insert into cbt.assessments (type, title, slug, description, caption, topic_label, day_number, subject_id, time_limit_sec,
                               opens_at, attempts_allowed, shuffle_questions, shuffle_options, answers_visibility, ranked,
                               offline_allowed, guests_allowed, featured, result_config, source_note, status)
  values ('daily_quiz', v_title, v_slug, v_desc, v_caption, v_topic, v_day, case when v_dow <= 5 then v_subject_id end, 300,
          v_opens, null, true, true, 'after_submit', true, false, true, true, '{"pass_mark": 60}'::jsonb,
          'Built automatically by cbt.build_daily_quiz from published JAMB past questions',
          (case when v_opens <= now() then 'live' else 'scheduled' end)::cbt.assessment_status)
  returning id into v_a;
  insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
  select v_a, q.id, q.version, array_position(v_ids, q.id) from cbt.questions q where q.id = any (v_ids);
  insert into cbt.daily_topic_log (quiz_date, subject_id, topic_id, assessment_id)
  select v_date, s.id, case when v_dow <= 5 then v_topic_id end, case when s.code = (v_mix -> 0 ->> 'code') then v_a end
  from cbt.subjects s where s.code in (select x ->> 'code' from jsonb_array_elements(v_mix) x);

  return jsonb_build_object('dry_run', false, 'date', v_date, 'day_number', v_day, 'assessment_id', v_a, 'title', v_title,
                            'slug', v_slug, 'url', 'https://techmedng.com/quizzes/' || v_slug, 'caption', v_caption);
end $$;

-- n questions of one subject (optionally one topic, or Organic Chemistry only), hardest known first, then random;
-- at most one diagram question per call.
create or replace function cbt._daily_pick(p_date date, p_code text, p_topic int, p_organic boolean, p_n int, p_exclude uuid[])
returns uuid[] language sql volatile security definer set search_path = cbt, pg_temp as $$
  select coalesce(array_agg(id order by rn), '{}') from (
    select id, row_number() over (order by correct_rate asc nulls last, r) rn from (
      select p.id, p.correct_rate, p.r, p.has_media,
             row_number() over (partition by p.has_media order by p.correct_rate asc nulls last, p.r) media_rank
      from (select e.*, random() r from cbt._daily_eligible(p_date) e) p
      left join cbt.topics t on t.id = p.topic_id
      where p.subject_code = p_code and (p_topic is null or p.topic_id = p_topic)
        and (not p_organic or t.name = 'Organic Compounds') and not (p.id = any (p_exclude))) c
    where not has_media or media_rank = 1
    order by correct_rate asc nulls last, r
    limit greatest(p_n, 0)) x $$;
revoke execute on function cbt._daily_pick(date, text, int, boolean, int, uuid[]) from public, anon, authenticated;

revoke execute on function cbt.build_daily_quiz(date, boolean) from public, anon;
grant execute on function cbt.build_daily_quiz(date, boolean) to authenticated, service_role;   -- staff only (checked inside)

-- ── 4. Schedule and the 05:00 watchdog ──────────────────────────────────────────────────────
create or replace function cbt.daily_quiz_watchdog()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v_date date := (now() at time zone 'Africa/Lagos')::date; v_err text; v_res jsonb;
begin
  if exists (select 1 from cbt.assessments where type = 'daily_quiz' and status <> 'archived'
             and (opens_at at time zone 'Africa/Lagos')::date = v_date) then
    return jsonb_build_object('ok', true);
  end if;
  begin
    v_res := cbt.build_daily_quiz(v_date);      -- one retry
    return jsonb_build_object('ok', true, 'retried', true, 'result', v_res);
  exception when others then v_err := sqlerrm;
  end;
  insert into cbt.audit_log (actor, action, entity, entity_id, diff)
  values (null, 'daily_quiz_missing', 'daily_quiz', v_date::text, jsonb_build_object('error', v_err));
  perform public.notify_email(jsonb_build_object('type', 'admin_alert',
    'subject', 'No Daily Builder Quiz for ' || to_char(v_date, 'Dy DD Mon'),
    'message', 'KAIRO could not build today''s Daily Builder Quiz (Day ' || (v_date - date '2026-11-10') || '). Error: '
               || coalesce(v_err, 'unknown') || '. Run select cbt.build_daily_quiz(); in Supabase, or publish one by hand.'));
  return jsonb_build_object('ok', false, 'error', v_err);
end $$;
revoke execute on function cbt.daily_quiz_watchdog() from public, anon, authenticated;

select cron.schedule('techmed-daily-quiz-build', '30 3 * * *', 'select cbt.build_daily_quiz()');      -- 04:30 WAT
select cron.schedule('techmed-daily-quiz-watchdog', '0 4 * * *', 'select cbt.daily_quiz_watchdog()'); -- 05:00 WAT
