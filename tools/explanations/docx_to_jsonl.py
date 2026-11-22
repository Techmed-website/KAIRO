#!/usr/bin/env python3
"""Turn a Word file of copied chat replies into one JSON-Lines file per assistant.

Each paragraph holding one JSON object is taken as one answer. A paragraph that is just an assistant's
name ("Gemini", "ChatGPT") switches the assistant for what follows; with no such heading everything is
treated as `default` (gemini). Paragraphs that are not valid JSON objects with an "id" are counted and skipped.
Usage: python3 -I docx_to_jsonl.py reply.docx BATCHNAME out_dir [default_assistant]
Writes out_dir/BATCHNAME.<assistant>.txt (the name format ingest.py / check_output.py expect).
"""
import html, json, os, re, sys, zipfile

path, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
who = (sys.argv[4] if len(sys.argv) > 4 else "gemini").lower()
os.makedirs(out, exist_ok=True)
xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf8")
paras = [html.unescape("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, flags=re.S)))
         for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)]
got, bad = {}, 0
for t in paras:
    s = t.strip()
    if s.lower() in ("gemini", "chatgpt", "claude", "copilot", "deepseek"):
        who = s.lower(); continue
    if not s.startswith("{"):
        continue
    try:
        d = json.loads(s)
    except json.JSONDecodeError:
        bad += 1; continue
    if isinstance(d, dict) and "id" in d:
        got.setdefault(who, []).append(json.dumps(d, ensure_ascii=False))
for w, lines in got.items():
    p = os.path.join(out, f"{name}.{w}.txt")
    open(p, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"{p}: {len(lines)} answers" + (f" ({bad} unreadable paragraphs skipped)" if bad else ""))
