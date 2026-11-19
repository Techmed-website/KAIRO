# Explanation batches for ChatGPT / Gemini

`batches/<era>/<SUBJECT>_<YEAR>.jsonl` holds every published question that still needs an explanation
(9,231 on 19 Nov 2026: 5,019 from 1978–2000, 4,212 from 2001–2025), one JSON object per line, with the
database id. Diagram questions are left out because a text chat cannot see the picture. Questions whose two
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
Put the output files in a folder (zip is fine) and upload them in the KAIRO Claude Code session. Claude runs
`tools/explanations/check_output.py`, which validates every line (exact id, answer is an option, a
"why not" line for every wrong option, sensible length) and splits them into:
- `merged/accepted.jsonl`: assistant agrees with our key and everything is valid → loaded into the database;
- `merged/review.jsonl`: the assistant disagrees with our key, was unsure, or a line has a problem → a TECHMED
  editor decides (or we run it past the second assistant).
Loading happens by script, so the questions never pass through the chat.
