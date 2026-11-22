#!/usr/bin/env python3
"""Load Gemini/ChatGPT explanation replies from content/explanations/inbox into KAIRO (runs in GitHub Actions).

Accepts PDFs and Word (.docx) files of copied chat replies, and .txt/.jsonl files of JSON Lines.
Only Gemini answers are loaded (set ASSISTANTS=gemini,chatgpt to allow more): the 2015 pilot showed ChatGPT
drifting from the format and missing key errors. A file with no assistant in its name counts as Gemini. Every answer is checked with the
same rules as check_output.py (TECHMED fields, exact id, specific why-not for every wrong option, ...):
  - verdict agree + valid            -> cbt.save_explanation (TECHMED format; skipped if the key changed or an
                                         editor already wrote one)
  - disagree / ambiguous / invalid   -> cbt.flag_key -> Question desk for an editor to decide
  - format problems                  -> reported only (re-run that batch)
Env: SUPABASE_SERVICE_ROLE_KEY (required), SUPABASE_URL (optional), DRY_RUN=1 to check without writing.
Usage: python3 -I tools/explanations/ingest.py content/explanations/inbox
"""
import glob, json, os, subprocess, sys, tempfile, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_output as C  # noqa: E402

URL = os.environ.get("SUPABASE_URL", "https://unbgborbhxzsotaieiun.supabase.co")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DRY = os.environ.get("DRY_RUN") == "1"


def rest(method, path, body=None, profile="cbt"):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
         "Accept-Profile": profile, "Content-Profile": profile}
    req = urllib.request.Request(URL + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or "null")


def fmt(r):
    lines = [f"Concept: {r['concept']}", "Steps:", *[f"{i + 1}. {s}" for i, s in enumerate(r["steps"])],
             "Why the other options are wrong:"]
    lines += [f"{w['option']}: {w['explanation']}" for w in sorted(r["why_not"], key=lambda w: w["option"])]
    lines.append(f"TECHMED TIP: {r['tip']}")
    return "\n".join(lines)


def main():
    inbox = sys.argv[1]
    batches = C.load_batches(os.path.join(HERE, "..", "..", "content", "explanations", "batches"))
    work = tempfile.mkdtemp()
    files = []
    for f in sorted(glob.glob(os.path.join(inbox, "*"))):
        base = os.path.splitext(os.path.basename(f))[0]
        if f.lower().endswith(".pdf"):
            subprocess.run([sys.executable, "-I", os.path.join(HERE, "pdf_to_jsonl.py"), f, base, work], check=True)
        elif f.lower().endswith(".docx"):
            subprocess.run([sys.executable, "-I", os.path.join(HERE, "docx_to_jsonl.py"), f, base, work], check=True)
        elif f.lower().endswith((".txt", ".jsonl", ".json")):
            files.append(f)
    files += sorted(glob.glob(os.path.join(work, "*.txt")))
    allowed = {a.strip().lower() for a in os.environ.get("ASSISTANTS", "gemini").split(",")}
    def assistant(path):
        parts = os.path.basename(path).split(".")
        return parts[-2].lower() if len(parts) >= 3 else "gemini"
    skipped_files = [os.path.basename(f) for f in files if assistant(f) not in allowed]
    files = [f for f in files if assistant(f) in allowed]

    best, errors = {}, []
    for path in files:   # later files win for the same id
        for o, err in C.objects(path):
            if err:
                errors.append(err); continue
            q = batches.get(str(o.get("id", "")).strip())
            if not q:
                errors.append(f"{os.path.basename(path)}: unknown id {o.get('id')!r}"); continue
            rec, probs = C.check(o, q)
            best[q["id"]] = {**rec, "id": q["id"], "key_given": q.get("key_given"), "problems": probs,
                             "model": "chat:" + (os.path.basename(path).split(".")[-2] if os.path.basename(path).count(".") >= 2 else "gemini")}

    ids = {}
    refs = list(best)
    for i in range(0, len(refs), 80):
        chunk = ",".join('"' + r + '"' for r in refs[i:i + 80])
        for row in (rest("GET", "/rest/v1/questions?select=id,source_ref&source_ref=in." + urllib.parse.quote(f"({chunk})")) if KEY else []):
            ids[row["source_ref"]] = row["id"]

    n = {"answers": len(best), "saved": 0, "save_skipped": 0, "to_editor": 0, "format_problems": 0, "not_in_db": 0}
    for ref, r in best.items():
        qid = ids.get(ref)
        if r["problems"]:
            n["format_problems"] += 1; errors.append(f"{ref}: {'; '.join(r['problems'])}"); continue
        if KEY and not qid:
            n["not_in_db"] += 1; continue
        if r["verdict"] == "agree" and r["key_given"]:
            if DRY: n["saved"] += 1; continue
            ok = rest("POST", "/rest/v1/rpc/save_explanation", {"p": {"question_id": qid, "explanation": fmt(r),
                      "model": r["model"], "expected_option": r["key_given"]}})
            n["saved" if ok else "save_skipped"] += 1
        else:
            verdict = r["verdict"] if r["verdict"] in ("disagree", "ambiguous", "invalid") else "disagree"
            if not DRY:
                rest("POST", "/rest/v1/rpc/flag_key", {"p": {"question_id": qid, "verdict": verdict,
                     "proposed_option": r["correct_option"] if verdict == "disagree" and r["correct_option"] != r["key_given"] else None,
                     "reasoning": (r["reasoning_for_editor"] or "No reason given.")[:4000], "model": r["model"]}})
            n["to_editor"] += 1

    summary = ["## Explanation import", "", "| | count |", "|---|---|"] + [f"| {k} | {v} |" for k, v in n.items()]
    if skipped_files:
        summary += ["", "Skipped (not from an allowed assistant): " + ", ".join(skipped_files)]
    if errors:
        summary += ["", f"### Problems ({len(errors)}, first 40)", ""] + [f"- {e}" for e in errors[:40]]
    text = "\n".join(summary)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(text + "\n")


if __name__ == "__main__":
    main()
