#!/usr/bin/env python3
"""Validate and merge explanation files returned by ChatGPT / Gemini.

Each returned file holds JSON Lines (one object per question), possibly wrapped in ``` fences or mixed
with chat text; anything that is not a valid object line is ignored and reported. Expected object:
  {"id": "myschool:q12840", "answer": "C", "key_check": "agree" | "disagree" | "unsure",
   "explanation": "...", "why_not": {"A": "...", "B": "...", "D": "..."}}

Usage: python3 -I check_output.py content/explanations/batches  returned_file [returned_file ...]
Writes content/explanations/merged/accepted.jsonl (safe to load), review.jsonl (key disagreements,
unsure, or problems) and prints a summary. Later files win when the same id appears twice; the source
file name is kept, so ChatGPT and Gemini runs can be compared.
"""
import collections, glob, json, os, re, sys


def load_batches(d):
    qs = {}
    for f in glob.glob(os.path.join(d, "*", "*.jsonl")):
        for line in open(f, encoding="utf-8"):
            q = json.loads(line)
            qs[q["id"]] = q
    return qs


def objects(path):
    for raw in open(path, encoding="utf-8", errors="replace"):
        line = raw.strip().strip(",")
        if not line.startswith("{"):
            continue
        try:
            yield json.loads(line), None
        except json.JSONDecodeError as e:
            yield None, f"{os.path.basename(path)}: bad JSON ({e.msg}): {line[:80]}"


def check(o, q):
    probs = []
    keys = list(q["options"])
    ans = str(o.get("answer", "")).strip().upper()
    if ans not in keys:
        probs.append(f"answer {ans!r} not an option")
    exp = (o.get("explanation") or "").strip()
    if len(exp) < 40:
        probs.append("explanation missing or too short")
    if len(exp) > 1200:
        probs.append("explanation too long")
    wn = {str(k).upper(): (v or "").strip() for k, v in (o.get("why_not") or {}).items()}
    missing = [k for k in keys if k != ans and not wn.get(k)]
    if missing:
        probs.append(f"why_not missing {missing}")
    if ans in wn:
        probs.append("why_not includes the correct answer")
    given = q.get("key_given")
    kc = str(o.get("key_check", "")).lower()
    if given and ans and ans != given:
        kc = "disagree"
    if kc not in ("agree", "disagree", "unsure"):
        probs.append("key_check missing")
    return ans, exp, {k: wn[k] for k in keys if k != ans and wn.get(k)}, kc, probs


def main():
    qs = load_batches(sys.argv[1])
    out_dir = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "merged")
    os.makedirs(out_dir, exist_ok=True)
    best, errors, stats = {}, [], collections.Counter()
    for path in sys.argv[2:]:
        for o, err in objects(path):
            if err:
                errors.append(err); stats["bad_json"] += 1; continue
            q = qs.get(str(o.get("id", "")).strip())
            if not q:
                errors.append(f"{os.path.basename(path)}: unknown id {o.get('id')!r}"); stats["unknown_id"] += 1; continue
            ans, exp, wn, kc, probs = check(o, q)
            rec = {"id": q["id"], "answer": ans, "key_given": q.get("key_given"), "key_check": kc,
                   "explanation": exp, "why_not": wn, "problems": probs, "source": os.path.basename(path)}
            best[q["id"]] = rec
    acc, rev = [], []
    for rec in best.values():
        ok = not rec["problems"] and rec["key_check"] == "agree" and rec["key_given"]
        (acc if ok else rev).append(rec)
        stats["accepted" if ok else "review"] += 1
        if rec["key_check"] == "disagree":
            stats["key_disagree"] += 1
    for name, rows in (("accepted.jsonl", acc), ("review.jsonl", rev)):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    stats["batch_questions"] = len(qs)
    stats["still_missing"] = len(qs) - len(best)
    print(json.dumps(dict(stats), indent=1))
    for e in errors[:15]:
        print("  ", e)


if __name__ == "__main__":
    main()
