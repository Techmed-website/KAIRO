#!/usr/bin/env python3
"""Upload normalised questions (normalize.py output) into cbt.questions via the temporary
public.cbt_import_questions RPC (see supabase/migrations/20261118010000_cbt_question_import.sql; removed by 20261118040000 when content loading moves to /admin).

Usage:
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... IMPORT_TOKEN_FILE=path \\
    python3 -I upload.py questions.jsonl [--batch 400] [--only ready,ai_key]

Everything is imported as DRAFT. Publishing is a separate, reviewed step.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


TOPICS = {}   # uid -> {topic, confidence, auto, source}, loaded by main() from --topics
HERE = os.path.dirname(os.path.abspath(__file__))
QIMG = os.path.join(HERE, "..", "..", "apps", "kairo", "public", "qimg")
OVERRIDES = json.load(open(os.path.join(HERE, "overrides.json"), encoding="utf-8"))


def served_image(name):
    """Same naming rule as the hosted files and the media_url SQL: extension -> .webp, unsafe chars -> '-'."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.splitext(name)[0]) + ".webp"


def apply_review_state(row):
    """Diagrams already hosted in apps/kairo/public/qimg no longer block; manual flags always apply."""
    flags = list(row["flags"])
    if row.get("image_file") and os.path.exists(os.path.join(QIMG, served_image(row["image_file"]))):
        flags = [f for f in flags if f != "image_not_hosted"]
    extra = OVERRIDES["flags"].get(row["source_ref"], [])
    flags = list(dict.fromkeys(flags + extra))
    if extra:
        status = "needs_review"
    elif row["import_status"] == "needs_review" and not flags:
        status = "ready" if row["key_source"] == "source" else ("ai_key" if row["correct"] else "needs_key")
    else:
        status = row["import_status"]
    row["flags"], row["import_status"] = flags, status
    return row


def to_row(r):
    # 1978-2000 files carry MySchool's real question id. The 2000-2025 files only have the id from the
    # page URL, which repeats, so those get a content fingerprint (subject + year + stem + options).
    if r.get("api") and r.get("source_ref"):
        ref = f"myschool:{r['source_ref']}"
    else:
        fp = hashlib.md5((norm(r["stem_text"]) + "|" + "|".join(norm(o["html"]) for o in r["options"])).encode()).hexdigest()[:16]
        ref = f"text:{r['subject'].lower()}:{r['year']}:{fp}"
    return {
        "source_ref": ref,
        "legacy_id": r.get("explanation_legacy_id"),
        "subject": r["subject"],
        "year": r["year"],
        "stem": r["stem_text"] or "(see diagram)",
        "stem_html": r["stem_html"],
        "options": r["options"],
        "content_hash": hashlib.md5(norm(r["stem_text"]).encode()).hexdigest(),
        "import_status": r["status"],
        "flags": r["flags"],
        "correct": r.get("correct"),
        "key_source": r.get("key_source"),
        "passage": r.get("passage"),
        "image_file": r.get("image_file"),
        **({"topic": t["topic"], "topic_source": t["source"], "topic_confidence": t["confidence"],
            "topic_auto": t["auto"]} if (t := TOPICS.get(r["uid"])) else {}),
    }


def post(url, key, token, rows):
    body = json.dumps({"p_token": token, "p_rows": rows}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/cbt_import_questions", data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl")
    ap.add_argument("--batch", type=int, default=400)
    ap.add_argument("--only", help="comma-separated import statuses to include")
    ap.add_argument("--topics", help="tag_topics.py output to attach topic labels")
    a = ap.parse_args()
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"]
    token = open(os.environ["IMPORT_TOKEN_FILE"]).read().strip()
    only = set(a.only.split(",")) if a.only else None

    if a.topics:
        TOPICS.update(json.load(open(a.topics, encoding="utf-8"))["topics"])
    rows = [apply_review_state(to_row(json.loads(l))) for l in open(a.jsonl, encoding="utf-8")]
    if only:
        rows = [r for r in rows if r["import_status"] in only]
    bad = [r for r in rows if len(r["options"]) not in (4, 5)]
    if bad:
        print(f"skipping {len(bad)} record(s) without 4-5 options: {[r['source_ref'] for r in bad]}", file=sys.stderr)
        rows = [r for r in rows if len(r["options"]) in (4, 5)]
    refs = [r["source_ref"] for r in rows]
    dup = len(refs) - len(set(refs))
    if dup:
        sys.exit(f"{dup} duplicate source_ref values; fix before uploading")

    totals = {"questions": 0, "keys": 0, "skipped_published": 0}
    for i in range(0, len(rows), a.batch):
        chunk = rows[i:i + a.batch]
        for attempt in range(4):
            try:
                res = post(url, key, token, chunk)
                break
            except urllib.error.HTTPError as e:  # a data error: show the server's message and stop
                sys.exit(f"batch starting at row {i}: HTTP {e.code}: {e.read()[:800]!r}")
            except Exception as e:  # network hiccup: back off and retry the same batch (upsert is idempotent)
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
                print(f"retry batch {i}: {e}", file=sys.stderr)
        for k in totals:
            totals[k] += res.get(k, 0)
        print(f"{min(i + a.batch, len(rows))}/{len(rows)} {res}", flush=True)
    print("TOTAL", totals)


if __name__ == "__main__":
    main()
