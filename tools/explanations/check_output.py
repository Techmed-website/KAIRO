#!/usr/bin/env python3
"""Validate and merge explanation files returned by ChatGPT / Gemini.

Each returned file holds JSON Lines (one object per question), possibly wrapped in ``` fences or mixed
with chat text; anything that is not a valid object line is ignored and reported. Expected object (the same
fields as the automated pipeline's TutorResult in tools/explain/core.ts):
  {"id": "myschool:q12840", "verdict": "agree|disagree|ambiguous|invalid", "correct_option": "C",
   "concept": "...", "steps": ["..."], "why_not": [{"option": "A", "explanation": "..."}, ...],
   "tip": "...", "reasoning_for_editor": "..."}
Decision rules mirror decide() in core.ts: saved only when the verdict is agree, the option equals our key,
every wrong option has a specific why-not, and concept, steps and tip are present. Everything else goes to
review (disagree/ambiguous/invalid become key reviews for the Question desk).

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


GENERIC = re.compile(r"^(this|it|option [a-e]|[a-e])?( is| are)? (wrong|incorrect|not correct)\.?$", re.I)


def check(o, q):
    probs = []
    keys = list(q["options"])
    verdict = str(o.get("verdict", "")).strip().lower()
    verdict = {"correct": "agree", "confirmed": "agree", "agreed": "agree", "unsure": "ambiguous"}.get(verdict, verdict)
    if verdict not in ("agree", "disagree", "ambiguous", "invalid"):
        probs.append("verdict missing"); verdict = "invalid"
    ans = str(o.get("correct_option", "")).strip().upper()
    if ans not in keys:
        probs.append(f"correct_option {ans!r} not an option")
    given = q.get("key_given")
    if verdict == "agree" and given and ans != given:
        verdict = "disagree"     # says agree but picked another option: treat as a disagreement
    wn_raw = o.get("why_not") or []
    if isinstance(wn_raw, dict):
        wn_raw = [{"option": k, "explanation": v} for k, v in wn_raw.items()]
    wn = {str(w.get("option", "")).upper(): (w.get("explanation") or "").strip() for w in wn_raw if isinstance(w, dict)}
    missing = [k for k in keys if k != ans and not wn.get(k)]
    if missing:
        probs.append(f"why_not missing {missing}")
    generic = [k for k, v in wn.items() if GENERIC.match(v) or len(v) < 15]
    if generic:
        probs.append(f"why_not too generic {generic}")
    steps = [str(x).strip() for x in (o.get("steps") or []) if str(x).strip()]
    concept, tip = (o.get("concept") or "").strip(), (o.get("tip") or "").strip()
    if not concept or not steps or not tip:
        probs.append("missing concept, steps or tip")
    if any(chr(92) in str(v) for v in (o.get("concept"), o.get("tip"), *(o.get("steps") or []), *[(w or {}).get("explanation") if isinstance(w, dict) else w for w in (o.get("why_not") or [])])):
        probs.append("contains backslashes (maths must be Unicode)")
    rec = {"verdict": verdict, "correct_option": ans, "concept": concept, "steps": steps,
           "why_not": [{"option": k, "explanation": wn[k]} for k in keys if k != ans and wn.get(k)],
           "tip": tip, "reasoning_for_editor": (o.get("reasoning_for_editor") or "").strip()}
    return rec, probs


def main():
    qs = load_batches(sys.argv[1])
    out_dir = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "merged")
    os.makedirs(out_dir, exist_ok=True)
    best, errors, stats = {}, [], collections.Counter()
    per_src = collections.defaultdict(dict)   # assistant name (from file name, e.g. CHM_1990.gemini.txt) -> id -> rec
    for path in sys.argv[2:]:
        for o, err in objects(path):
            if err:
                errors.append(err); stats["bad_json"] += 1; continue
            q = qs.get(str(o.get("id", "")).strip())
            if not q:
                errors.append(f"{os.path.basename(path)}: unknown id {o.get('id')!r}"); stats["unknown_id"] += 1; continue
            rec, probs = check(o, q)
            best[q["id"]] = {"id": q["id"], "key_given": q.get("key_given"), **rec,
                             "problems": probs, "source": os.path.basename(path)}
            parts = os.path.basename(path).split(".")
            per_src[parts[-2] if len(parts) >= 3 else "unnamed"][q["id"]] = (rec, probs, q.get("key_given"))
    acc, rev = [], []
    for rec in best.values():
        ok = not rec["problems"] and rec["verdict"] == "agree" and rec["key_given"]
        (acc if ok else rev).append(rec)
        stats["accepted" if ok else "review"] += 1
        stats["verdict_" + rec["verdict"]] += 1
    for name, rows in (("accepted.jsonl", acc), ("review.jsonl", rev)):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    stats["batch_questions"] = len(qs)
    stats["still_missing"] = len(qs) - len(best)
    print(json.dumps(dict(stats), indent=1))
    if len(per_src) > 1:   # head-to-head comparison of assistants on the same questions
        print("\nAssistant comparison:")
        for name, recs in per_src.items():
            valid = sum(1 for r, p, _ in recs.values() if not p)
            agree = sum(1 for r, p, g in recs.values() if r["verdict"] == "agree" and r["correct_option"] == g)
            print(f"  {name}: {len(recs)} answered, {valid} fully valid, {agree} agree with our key")
        names = list(per_src)
        a, b = per_src[names[0]], per_src[names[1]]
        both = set(a) & set(b)
        diff = [i for i in both if a[i][0]["correct_option"] != b[i][0]["correct_option"]]
        print(f"  {names[0]} vs {names[1]}: {len(both)} in common, {len(diff)} pick different answers")
        for i in diff[:10]:
            print(f"    {i}: {names[0]}={a[i][0]['correct_option']} {names[1]}={b[i][0]['correct_option']} key={a[i][2]}")
    for e in errors[:15]:
        print("  ", e)


if __name__ == "__main__":
    main()
