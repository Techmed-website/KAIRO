# Explanation batches for ChatGPT / Gemini

`batches/<era>/<SUBJECT>_<YEAR>.jsonl` holds every published question that still needs an explanation
(9,231 on 19 Nov 2026: 5,019 from 1978–2000, 4,212 from 2001–2025), one JSON object per line, with the
database id (`source_ref`). The prompt (`PROMPT.md`) is generated from `tools/explain/techmed-method.md`, the same
TECHMED method the automated pipeline uses, so both write identical explanations. Diagram questions are left out because a text chat cannot see the picture. Questions whose two
answer keys disagree have `key_given: null` and a `key_note`.
Subjects: ENG, MTH, PHY, CHM, BIO.

## How to run a batch
1. New chat → paste the whole of `PROMPT.md` → the assistant replies READY.
2. Upload one batch file, e.g. `batches/1978-2000/CHM_1990.jsonl`, and say: `Do n=1 to 25`.
3. Copy the code block it returns into a text file. Then say `Continue with n=26 to 50`, and so on.
   Paste each new block into the same text file (one file per batch file is easiest).
4. Name the saved file after the batch and the assistant, e.g. `CHM_1990.chatgpt.txt` or `CHM_1990.gemini.txt`.
5. Start a fresh chat every 4–6 batch files: long chats get sloppy and drop fields.

Use the strongest reasoning/thinking model you have for Mathematics, Physics and Chemistry (the
calculations must be right); a faster model is fine for English and Biology.

## Comparing ChatGPT and Gemini first
Run the same two files on both, e.g. `batches/1978-2000/CHM_1990.jsonl` and `batches/2001-2025/MTH_2015.jsonl`,
and send all four output files back. The checker reports, for each assistant, how many lines were valid, how
often it agreed with our key, and where the two assistants disagree, so the better one wins on evidence.

## Sending results back to Claude
Put the output files in a folder (zip is fine) and upload them in a KAIRO Claude Code session. Claude runs
`tools/explanations/check_output.py`, which uses the same rules as the automated pipeline (`tools/explain`,
`decide()`): exact id, verdict, answer is an option, a specific "why not" for every wrong option, concept + steps +
tip present, no backslashes. It splits them into:
- `merged/accepted.jsonl`: verdict agree with our key and everything valid → saved with `cbt.save_explanation`
  in the TECHMED format (Concept / Steps / Why not / TECHMED TIP);
- `merged/review.jsonl`: disagree / ambiguous / invalid or a line with problems → disagreements become
  `cbt.key_reviews` on the Question desk; broken lines can be re-run.
Loading happens by script, so the questions never pass through the chat.

## Pilot result (19 Nov 2026: BIO, CHM, PHY 2015, both assistants, 98 questions)
**Gemini wins; use Gemini for all subjects.** Both answered every question. Gemini kept the exact format in all
98 answers, caught a wrong MySchool key (CHM furring of kettles: B, calcium hydrogentrioxocarbonate(IV), not D)
and an arithmetic mismatch (PHY angular velocity 2/0.7 = 2.86, not 3), and confirmed keys with a note instead of
flagging minor wording slips. ChatGPT drifted from the format in Physics (verdict "correct", why_not as a dict
that included the right option), missed both errors, and marked many answerable questions "ambiguous" (more
editor work). Merged: 94 accepted, 4 for editors. Saved in `returned/2015-pilot/`. The prompt now adds rules for
the weaknesses seen (specific why-not for numerical options, typo handling, exact verdict words).
Replies sent as PDFs: `python3 -I tools/explanations/pdf_to_jsonl.py reply.pdf PHY_2015 returned/<folder>/`.
