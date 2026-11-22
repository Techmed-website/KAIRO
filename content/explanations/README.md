# Explanation files for Gemini

`gemini/` holds every published question that still needs an explanation and can be answered from text alone
(live database, 22 Nov 2026): **6,157 questions in 30 files**. Questions that need a diagram are left out (989 more
are still unexplained; a text chat cannot see the picture). Each line has the database id (`myschool:q…`) and the
**current** answer key, including the corrections editors made on the Question desk.
The older per-year files in `batches/` are out of date; use `gemini/`.

| Folder | Files | Questions |
|---|---|---|
| `gemini/2001-2025/` (not 1978–2000) | one file per subject: `2001-2025_BIO`, `_CHM`, `_ENG`, `_MTH`, `_PHY` `.jsonl` | BIO 210 · CHM 627 · ENG 244 · MTH 32 · PHY 34 = 1,147 |
| `gemini/1978-2000/` | five parts per subject: `1978-2000_<SUBJECT>_part1of5` … `part5of5` `.jsonl` (25 files, oldest years first) | BIO 902 · CHM 809 · ENG 1,929 · MTH 602 · PHY 768 = 5,010 |

The prompt (`PROMPT.md`) is generated from `tools/explain/techmed-method.md`, the same TECHMED method the automated
pipeline uses, so both write identical explanations. Use **Gemini** for every subject (the pilot below).

## How to run one file (50 questions per "Go")
1. New Gemini chat (the strongest thinking model you have) → paste the whole of `PROMPT.md` → Gemini replies `READY`.
2. Upload ONE file, for example `gemini/1978-2000/1978-2000_CHM_part1of5.jsonl`, and type: `Go`
3. Gemini answers the next 50 questions (n=1 to 50) in one code block and ends with
   `DONE n=1 to 50 (50 questions). Say Go for n=51 to 100.` Check that the block has 50 lines.
4. Copy the code block into a text file and type `Go` again for the next 50. Paste every new block into the
   **same** file, one block after another, until Gemini says `FILE COMPLETE`.
5. Name the saved file after the question file and `gemini`, with no extra dots, e.g.
   `1978-2000_CHM_part1of5.gemini.txt` or `2001-2025_ENG.gemini.txt` (a Word `.docx` with the same name also works).
6. Use a fresh chat for each question file. Long chats get sloppy and drop fields. If Gemini is cut off, say `Go`;
   it continues from the first question it did not finish.

Mathematics, Physics and Chemistry are the ones where wrong answers hurt most: run those with the strongest model,
and skim the first block of each file for exact ids, 50 lines and no missing `why_not` entries before continuing.

## Loading the results
Upload the finished `.gemini.txt` files to `content/explanations/inbox/` on GitHub (Add file → Upload files → Commit).
The **Load explanations** workflow (`tools/explanations/ingest.py`) checks every line with the same rules as the
automated pipeline (exact id, verdict, answer is an option, a specific "why not" for every wrong option, concept +
steps + tip present, no backslashes), then:
- verdict `agree` and valid, key unchanged → saved with `cbt.save_explanation` in the TECHMED format;
- `disagree` / `ambiguous` / `invalid` → sent to the Question desk (`cbt.key_reviews`) for an editor;
- lines with format problems are listed in the run summary so they can be redone;
- the files move to `content/explanations/done/`.

Only Gemini answers are loaded (set `ASSISTANTS=gemini,chatgpt` to allow more). You can also check a file locally
with `tools/explanations/check_output.py` before uploading.

## Pilot result (19 Nov 2026: BIO, CHM, PHY 2015, both assistants, 98 questions)
**Gemini wins; use Gemini for all subjects.** Both answered every question. Gemini kept the exact format in all
98 answers, caught a wrong MySchool key (CHM furring of kettles: B, calcium hydrogentrioxocarbonate(IV), not D)
and an arithmetic mismatch (PHY angular velocity 2/0.7 = 2.86, not 3), and confirmed keys with a note instead of
flagging minor wording slips. ChatGPT drifted from the format in Physics, missed both errors, and marked many
answerable questions "ambiguous" (more editor work). Merged: 94 accepted, 4 for editors.
