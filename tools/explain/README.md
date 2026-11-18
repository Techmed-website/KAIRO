# KAIRO explanations (TECHMED method)

Writes an explanation for every question in the TECHMED method (concept → steps → why each wrong option is wrong →
TECHMED TIP) and re-checks every answer key on the way. The instructions the model follows are in
`techmed-method.md`; edit that file to change the house style.

What happens to each question:

| Model's verdict | What KAIRO does |
| --- | --- |
| agrees with the key, explains every wrong option | saved; students see it at once (`question_keys.explanation_source = 'ai_techmed'`) |
| disagrees, or finds the question ambiguous / broken | nothing changes for students; a row in `cbt.key_reviews` for a TECHMED editor |
| weak or generic "why not" lines | not saved; the question stays in the queue for the next batch |

Editor-written explanations (`explanation_source = 'editor'`) are never touched.

## Running it

From GitHub: **Actions → KAIRO explanations → Run workflow**. Needs two repository secrets: `ANTHROPIC_API_KEY`
(console.anthropic.com) and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API). Run `submit` with a limit,
then `collect` with the batch id about an hour later. Start with a batch of 100: `collect` prints the real cost.

Locally: `npm ci`, set the two variables, then `npm run queue`, `npm run submit -- --limit 100`,
`npm run collect -- <batch_id>`. Add `--dry-run` to collect without writing.

## Cost

Message Batches run at half price. With Claude Opus 5.5 at high effort, expect roughly $0.03–0.04 per question
(cached instructions, about 2–3k output tokens including reasoning), so about $300–400 for the ~10,000 questions still
missing a TECHMED explanation. Diagrams add a little. Measure on the first batch of 100 before committing to more.
