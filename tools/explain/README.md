# KAIRO explanations (TECHMED method)

Writes an explanation for every question in the TECHMED method (concept → steps → why each wrong option is wrong →
TECHMED TIP) and independently re-checks every answer key. The instructions the model follows are in
`techmed-method.md`; edit that file to change the house style.

**It costs nothing by default.** The default provider is the Gemini free tier. The Anthropic provider is still in the
code for hard questions, but it refuses to start unless you set `ALLOW_PAID_API=yes`, and the GitHub workflow never gives
it a key.

## What happens to each question

| Model's result | What KAIRO does |
| --- | --- |
| agrees with the key, explains every wrong option | saved; students see it at once (`explanation_source = 'ai_techmed'`) |
| weak or generic "why not" lines | asked again once, with the reason; still weak → recorded as failed |
| failed twice | leaves the queue; brought back later with `--retry-failed` (try a stronger model) |
| disagrees with the key, or finds the question ambiguous / broken | nothing changes for students; a row in `cbt.key_reviews` for an editor |
| editor-written explanation | never touched |

Editors resolve flagged questions with `select cbt.resolve_key_review(<id>, true)` (adopt the proposed key: new question
version, old explanation cleared, question explained again) or `(<id>, false)` (confirm the stored key; the pipeline then
explains it without disputing it). Past attempts always keep the key they were marked against.

## Setting up (about 10 minutes, once)

1. Get a Gemini key at aistudio.google.com → Get API key. Use a project **without billing**: with billing enabled, requests
   over the free limits are charged. The pipeline cannot detect this for you.
2. In GitHub → Settings → Secrets and variables → Actions, add secrets `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Run the workflow **KAIRO explanations** with action `models`, and pick a model from the list. Google's free-tier models and
   limits change; check the limits for your key in AI Studio and set `rpm` below them.

## Rollout

| Stage | Action | What to check |
| --- | --- | --- |
| 1 | `eval` | agreement with my hand-checked 9 questions; read the printed explanations yourself |
| 2 | `run`, limit 20, **dry run on** | the report: saved / flagged / failed counts |
| 3 | `run`, limit 20, dry run off | open the saved questions in the app and read them |
| 4 | `run`, limit 100, then 500 | flagged rate (a high rate means the model is too weak for key checking) |
| 5 | daily schedule | enable the commented `schedule` in the workflow; set repository variables `EXPLAIN_MODEL` and `EXPLAIN_LIMIT` |

Free quotas mean the ~10,000 questions take days, not hours; every run stops cleanly when the quota is used up and the next
run resumes where it stopped (explained questions leave the queue). Reserve a stronger model for the hard ones with
`--escalate gemini:<model>`, which is asked before any key is flagged to an editor.

## Things to know

- **Quality:** small free models are weaker at checking keys and at multi-step Physics and Maths. Judge the model on `eval`
  and on the flagged rate, not on how fluent it sounds. Teaching quality is checked by reading, not by a score.
- **Privacy:** on the free tier Google may use what you send to improve its products. The pipeline sends only the public
  past-question text, options and diagrams, never student names, emails or answers. Keep it that way.
- **Locally:** `npm ci`, set `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, then `npm run models`, `npm run eval`,
  `npm run run -- --model <id> --limit 20 --dry-run`. Reports land in `runs/`.
