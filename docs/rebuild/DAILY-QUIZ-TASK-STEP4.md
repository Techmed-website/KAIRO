# Daily Builder Quiz task: KAIRO version of STEP 4 and the Sanity step

Replaces STEP 4 (QuizBoot) and the Sanity paragraph in the scheduled task "TECHMED Daily Builder Quiz".
Steps 1–3 (day number, topic, writing 10 questions) stay. Topic history: read the titles from KAIRO with
`select title from cbt.assessments where type = 'daily_quiz' order by opens_at` (Supabase execute_sql, project
unbgborbhxzsotaieiun) as well as the old QuizBoot list, so topics never repeat across the switch.

STEP 4 — PUBLISH ON KAIRO. Call the Supabase tool execute_sql (project unbgborbhxzsotaieiun) with exactly one statement:
  select cbt.publish_daily_quiz($q${ JSON }$q$::jsonb);
where JSON is
  {"date": "<today, YYYY-MM-DD, Africa/Lagos>",
   "title": "TECHMED UTME 2027 Daily Builder Quiz — Day {N}: {Subject} ({Topic})",
   "duration_sec": 600,
   "questions": [{"subject": "PHY|CHM|BIO|MTH|ENG", "stem": "...", "passage": "<only for comprehension/cloze>",
                  "options": ["...", "...", "...", "..."], "correct": "A|B|C|D", "explanation": "..."}, ...10]}
- Options are plain text in the order you want them shown; "correct" is the letter of the right one (vary it).
- Explanations: say why the right answer is right and why the tempting wrong ones are wrong, without option letters.
- The reply gives assessment_id and url (https://kairo.techmedng.com/q/<id>). That url is the quiz link everywhere below.
- If it says a quiz for today already exists, do not publish again; reuse that quiz's link
  (`select id from cbt.assessments where type='daily_quiz' and status<>'archived' and (opens_at at time zone 'Africa/Lagos')::date = '<today>'`).
- If execute_sql fails, retry once; if it still fails, report it at the top of your reply.

SANITY: as before (_type "quiz", programme "Daily Builder", category "free", featured true, unfeature yesterday's),
but platform: "KAIRO" and quizUrl: the KAIRO url. Caption: same rules, with the KAIRO link and the line
"Sign in with your TECHMED account (free) to take it and see where you rank."
