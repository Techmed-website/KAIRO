#!/usr/bin/env python3
"""Turn a PDF of copied chat replies into one JSON-Lines file per assistant.

The PDF may hold several assistants' replies, each starting with a line that is just the assistant's name
(e.g. "ChatGPT" or "Gemini"). PDF text wraps long lines, so objects are found by matching braces and the
wraps are undone before parsing. Needs `pdftotext` (poppler-utils).
Usage: python3 -I pdf_to_jsonl.py reply.pdf BATCHNAME out_dir     e.g. ... Physics_2015.pdf PHY_2015 out/
Writes out_dir/BATCHNAME.<assistant>.txt (ready for check_output.py).
"""
import json, os, re, subprocess, sys

pdf, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
text = subprocess.run(["pdftotext", "-raw", pdf, "-"], capture_output=True, text=True, check=True).stdout
parts = re.split(r"(?m)^\s*(ChatGPT|Gemini|Claude|Copilot|DeepSeek)\s*$", text)
if len(parts) == 1:
    parts = ["", "unnamed", text]
for i in range(1, len(parts), 2):
    who, body = parts[i].lower(), parts[i + 1].replace("\f", " ")
    objs, depth, start, inq, esc = [], 0, None, False, False
    for j, ch in enumerate(body):
        if inq:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': inq = False
            continue
        if ch == '"': inq = True
        elif ch == "{":
            if depth == 0: start = j
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0:
                objs.append(body[start:j + 1])
    good = []
    for o in objs:
        try:
            d = json.loads(re.sub(r"\s*\n\s*", " ", o))
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and "id" in d:
            good.append(json.dumps(d, ensure_ascii=False))
    path = os.path.join(out, f"{name}.{who}.txt")
    open(path, "w", encoding="utf-8").write("\n".join(good) + "\n")
    print(f"{path}: {len(good)} of {len(objs)} objects parsed")
