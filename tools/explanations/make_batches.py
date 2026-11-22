#!/usr/bin/env python3
"""Write explanation batch files for outside chat assistants (ChatGPT / Gemini).

One JSONL file per era/subject/year under content/explanations/batches/, holding only published-quality
questions that still need an explanation. Each line is one question with its database id, so answers come
back mapped exactly. Questions that need a diagram are left out (a text chat can't see the picture), and
key conflicts get both candidate keys so the assistant can help decide.

Usage: python3 -I make_batches.py questions.jsonl topics.json out_dir
"""
import collections, html, json, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "question-import"))
import upload as U  # noqa: E402  (same id rules and review state as the database import)

SUBJ = {"ENG": "Use of English", "MTH": "Mathematics", "PHY": "Physics", "CHM": "Chemistry", "BIO": "Biology"}
ALREADY_EXPLAINED = set()   # refs explained in content/daily-quiz files


def plain(h):
    """HTML -> readable plain text: x<sup>2</sup> -> x^2, H<sub>2</sub>O -> H_2O, <br> -> newline."""
    s = h or ""
    s = re.sub(r"<sup>(.*?)</sup>", lambda m: "^" + (m.group(1) if len(m.group(1)) == 1 else "(" + m.group(1) + ")"), s, flags=re.S)
    s = re.sub(r"<sub>(.*?)</sub>", lambda m: "_" + m.group(1), s, flags=re.S)
    s = re.sub(r"<br\s*/?>|</p>|</tr>", "\n", s)
    s = re.sub(r"</t[dh]>", " | ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\r", "")
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def main():
    bank, topics, out = sys.argv[1], sys.argv[2], sys.argv[3]
    U.TOPICS.update(json.load(open(topics, encoding="utf-8"))["topics"])
    here = os.path.dirname(os.path.abspath(__file__))
    for f in os.listdir(os.path.join(here, "..", "..", "content", "daily-quiz")):
        if f.endswith(".json"):
            d = json.load(open(os.path.join(here, "..", "..", "content", "daily-quiz", f), encoding="utf-8"))
            ALREADY_EXPLAINED.update(q["ref"] for day in d["days"] for q in day["questions"])

    files = collections.defaultdict(list)
    stats = collections.Counter()
    for line in open(bank, encoding="utf-8"):
        r = json.loads(line)
        row = U.apply_review_state(U.to_row(r))
        conflict = r.get("key_conflict")
        usable = row["import_status"] in ("ready", "ai_key") or (row["flags"] == ["key_conflict"])
        if not usable or len(row["options"]) not in (4, 5):
            stats["skip_not_usable"] += 1; continue
        if r.get("image_file") or r.get("image_url"):
            stats["skip_diagram"] += 1; continue
        if r.get("explanation_legacy_id") or row["source_ref"] in ALREADY_EXPLAINED:
            stats["skip_has_explanation"] += 1; continue
        era = "1978-2000" if r["year"] <= 2000 else "2001-2025"
        q = {"id": row["source_ref"], "subject": SUBJ[r["subject"]], "year": r["year"],
             "topic": (row.get("topic") or None),
             "question": plain(r["stem_html"]),
             "options": {o["key"]: plain(o["html"]) for o in r["options"]}}
        if r.get("passage"):
            q["passage"] = plain(r["passage"]["html"])
        if conflict:
            q["key_given"] = None
            q["key_note"] = f"Two sources disagree: one says {conflict['myschool']}, the other says {conflict['legacy_ai']}. Work it out and decide."
            stats["key_conflict"] += 1
        else:
            q["key_given"] = row["correct"]
        files[(era, r["subject"], r["year"])].append(q)
        stats["included"] += 1

    for (era, subj, year), qs in files.items():
        d = os.path.join(out, era); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{subj}_{year}.jsonl"), "w", encoding="utf-8") as fh:
            for i, q in enumerate(qs, 1):
                fh.write(json.dumps({"n": i, **q}, ensure_ascii=False) + "\n")
    per_era = collections.Counter()
    for (era, _, _), qs in files.items():
        per_era[era] += len(qs)
    print(dict(stats), dict(per_era), len(files), "files")


if __name__ == "__main__":
    main()
