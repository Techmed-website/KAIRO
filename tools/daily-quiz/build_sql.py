#!/usr/bin/env python3
"""Turn a content/daily-quiz/*.json week file into SQL that:
  1. applies text fixes (stem / option text) to the draft questions,
  2. stores the explanations on the answer keys,
  3. publishes the questions (the snapshot trigger freezes version 1),
  4. creates one daily quiz per day as 'scheduled' (opens 05:00 UTC = 06:00 WAT, never closes,
     10 questions / 5 minutes, unranked, answers right after submit, can be taken offline).
The pg_cron job 'kairo-daily-quiz-publish' flips scheduled quizzes to live when they open.
Usage: python3 -I build_sql.py week.json > out.sql
"""
import html, json, sys

def lit(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"

doc = json.load(open(sys.argv[1], encoding="utf-8"))
out = ["begin;"]
for day in doc["days"]:
    for q in day["questions"]:
        ref, fix = q["ref"], q.get("fix", {})
        if "stem" in fix:
            out.append(f"update cbt.questions set stem = {lit(fix['stem'])}, stem_html = {lit(html.escape(fix['stem'], quote=False))} "
                       f"where source_ref = {lit(ref)} and status = 'draft';")
        for key, text in fix.get("options", {}).items():
            out.append(f"update cbt.questions set options = (select jsonb_agg(case when o->>'key' = {lit(key)} "
                       f"then jsonb_set(o, '{{html}}', to_jsonb({lit(html.escape(text, quote=False))}::text)) else o end order by ord) "
                       f"from jsonb_array_elements(options) with ordinality t(o, ord)) where source_ref = {lit(ref)} and status = 'draft';")
        out.append(f"update cbt.question_keys k set explanation = {lit(q['explanation'])} from cbt.questions qq "
                   f"where qq.id = k.question_id and qq.source_ref = {lit(ref)};")
    refs = ", ".join(lit(q["ref"]) for q in day["questions"])
    out.append(f"update cbt.questions set status = 'published', reviewed_at = now() where source_ref in ({refs}) and status = 'draft';")
    title = f"KAIRO Daily Quiz: {day['title']}"
    out.append(f"""with a as (
  insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility, ranked, offline_allowed, status)
  values ('daily_quiz', {lit(title)}, 300, {lit(day['date'] + ' 05:00:00+00')}, null, 'after_submit', false, true, 'scheduled')
  returning id)
insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
select a.id, q.id, q.version, x.pos from a,
  unnest(array[{refs}]) with ordinality x(ref, pos) join cbt.questions q on q.source_ref = x.ref;""")
out.append("commit;")
print("\n".join(out))
