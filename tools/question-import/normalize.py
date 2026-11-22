#!/usr/bin/env python3
"""Normalise the TECHMED JAMB past-question files into one canonical JSONL.

Inputs (any order; detected by shape):
  NOTE: "source" keys are MySchool's answer keys, not JAMB's. They are cross-checked against the legacy
  keys and conflicts are flagged (key_conflict) for an editor.

  * 1978-2000 "master" files: {metadata, progress, questions:[{question_html, options:[{tag,text_html,is_correct}], ...}]}
    or a bare list of the same records (JAMB_PHYSICS_1978_2000_ALL.json).
  * 2000-2025 "master" files: [{year, subject, question, option_a..option_e, diagram_url, source_url}]
    These have NO answer key. Keys are borrowed by exact stem match from the
    existing kairo.questions bank (export given with --kairo). Those keys were
    produced by Claude (scripts/qim/generate_qim_batch.py), not taken from the
    source: on 261 questions that also have a source key they agree 96.2% of
    the time. They are labelled key_source="ai_legacy" and status "ai_key", so
    they are never treated as verified.

Output:
  * <out>/questions.jsonl: one canonical record per unique question
  * <out>/report.json: counts used by docs/rebuild/QUESTION-IMPORT-REPORT.md

Usage:
  python3 -I normalize.py --out DIR [--kairo kairo_export.json] FILE.json [FILE.json ...]

The kairo export is the saved result of:
  select id, subject, year, md5(regexp_replace(lower(stem),'[^a-z0-9]','','g')) h,
         (select regexp_replace(lower(e->>'text'),'[^a-z0-9]','','g') from jsonb_array_elements(options) e
           where (e->>'isCorrect')::boolean limit 1) k,
         length(coalesce(explanation,'')) el, lifecycle_state ls
  from kairo.questions;
"""
import argparse
import collections
import hashlib
import html
import json
import os
import re
import sys

SUBJECTS = {
    "biology": "BIO", "chemistry": "CHM", "physics": "PHY", "mathematics": "MTH",
    "english language": "ENG", "english-language": "ENG", "use of english": "ENG",
}
KAIRO_SUBJECT = {"BIO": "Biology", "CHM": "Chemistry", "PHY": "Physics", "MTH": "Mathematics", "ENG": "Use of English"}
KEYS = "ABCDE"

DIAGRAM_REF = re.compile(r"diagram|figure|graph above|shown above|the above|image above|circuit (?:above|shown)|in the (?:table|sketch)", re.I)
PASSAGE_REF = re.compile(r"\b(passage|extract|stanza|poem)\b", re.I)
# "3x 2 - x 3", "(a + b) 2", "10 -3": a superscript that became a space plus a digit when the
# source HTML was flattened. Only checked on plain-text (2000-2025) science and maths stems.
LOST_SUPERSCRIPT = re.compile(r"(?:(?<![A-Za-z])[a-z]|\)) -?[2-9](?=\s*[-+=)<>,.?]|\s*$|\s+[a-z]\b)")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s or ""))


def text_to_html(s):
    """Plain text (possibly with LaTeX delimiters) -> safe HTML. LaTeX is left for KaTeX at render time."""
    return html.escape((s or "").strip(), quote=False).replace("\r\n", "\n").replace("\n", "<br>")


def clean_html(s):
    """Light clean-up of source HTML: drop wrapping <p>, CRs, and empty paragraphs."""
    s = (s or "").replace("\r", "").strip()
    s = re.sub(r"^<p>(.*)</p>$", r"\1", s, flags=re.S)
    s = re.sub(r"<p>\s*(&nbsp;)?\s*</p>", "", s)
    return s.strip()


def load(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return data["questions"] if isinstance(data, dict) and "questions" in data else data


def from_old(q, src_file):
    """1978-2000 record (source has answer keys and HTML)."""
    subj = SUBJECTS[q["subject"].lower()]
    opts = sorted(q["options"], key=lambda o: o["tag"])
    options = [{"key": o["tag"].upper(), "html": clean_html(o.get("text_html") or text_to_html(o.get("text")))} for o in opts]
    correct = [o["tag"].upper() for o in opts if o.get("is_correct")]
    link = q.get("linkage") or q
    ref = link.get("ref") or (q.get("english_structure") or {}).get("ref")
    passage = None
    if ref and ref.get("description"):
        passage = {"key": f"ref:{ref.get('id')}", "html": clean_html(ref["description"])}
    image = (q.get("image") or "").strip() or None
    return {
        "subject": subj,
        "year": int(q["exam_year"]),
        "source": "myschool",
        "source_ref": f"q{q['question_id']}",
        "stem_html": clean_html(q.get("question_html") or text_to_html(q.get("question_text"))),
        "stem_text": (q.get("question_text") or strip_tags(q.get("question_html"))).strip(),
        "passage": passage,
        "options": options,
        "correct": correct[0] if len(correct) == 1 else None,
        "key_source": "source" if len(correct) == 1 else None,
        "key_problem": None if len(correct) == 1 else f"{len(correct)} options marked correct",
        "image_url": image,
        "explanation_legacy_id": None,
        "file": os.path.basename(src_file),
        "api": True,
    }


def from_new(q, src_file):
    """2000-2025 record (no answer key; plain text with LaTeX)."""
    subj = SUBJECTS[q["subject"].lower()]
    options = [{"key": k.upper(), "html": text_to_html(q.get("option_" + k))}
               for k in "abcde" if (q.get("option_" + k) or "").strip()]
    m = re.search(r"/(\d+)\?", q.get("source_url") or "")
    return {
        "subject": subj,
        "year": int(q["year"]),
        "source": "myschool",
        "source_ref": f"q{m.group(1)}" if m else None,
        "stem_html": text_to_html(q["question"]),
        "stem_text": q["question"].strip(),
        "passage": None,
        "options": options,
        "correct": None,
        "key_source": None,
        "key_problem": None,
        "image_url": q.get("diagram_url") or None,
        "explanation_legacy_id": None,
        "file": os.path.basename(src_file),
        "api": False,
    }


def load_kairo(path):
    raw = open(path, encoding="utf-8").read()
    try:
        outer = json.loads(raw)
        txt = outer["result"] if isinstance(outer, dict) else raw
    except json.JSONDecodeError:
        txt = raw
    if isinstance(txt, list):
        rows = txt
    else:
        rows = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
    by_hash = collections.defaultdict(list)
    for r in rows:
        by_hash[(r["subject"], r["h"])].append(r)
    return by_hash


def flags_for(r):
    f = []
    n = len(r["options"])
    if n not in (4, 5):
        f.append(f"option_count_{n}")
    texts = [norm(strip_tags(o["html"])) for o in r["options"]]
    if any(not t for t in texts):
        f.append("empty_option")
    if len(set(texts)) < len(texts):
        f.append("duplicate_options")  # usually lost superscripts/fractions
    has_image = r.get("image_url") or r.get("image_file")
    if len(norm(r["stem_text"])) < 8 and not has_image:
        f.append("short_stem")
    if DIAGRAM_REF.search(r["stem_text"]) and not has_image:
        f.append("diagram_missing")
    if r["subject"] == "ENG" and PASSAGE_REF.search(r["stem_text"]) and not r["passage"]:
        f.append("passage_missing")
    if r["subject"] in ("MTH", "PHY", "CHM") and "<" not in r["stem_html"].replace("<br>", "") \
            and LOST_SUPERSCRIPT.search(r["stem_text"]):
        f.append("possible_lost_superscript")
    return f


def classify_image(r):
    """Source image fields are bare file names (e.g. '1378984287_bio197826.jpg'), not URLs, and a few
    are placeholder text. Neither is displayable: the file must be fetched and hosted by us first."""
    img = r.pop("image_url")
    r["image_url"], r["image_file"] = None, None
    if not img:
        return []
    if img.startswith("["):
        return ["diagram_missing"]
    if re.match(r"^https?://", img) and "myschool" not in img:
        r["image_url"] = img
        return []
    r["image_file"] = img.rsplit("/", 1)[-1]
    return ["image_not_hosted"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--kairo", help="saved kairo.questions export (see module docstring)")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    kairo = load_kairo(a.kairo) if a.kairo else {}
    records, per_file = [], collections.Counter()
    for path in a.files:
        for q in load(path):
            rec = from_old(q, path) if "options" in q else from_new(q, path)
            records.append(rec)
            per_file[rec["file"]] += 1

    # Official (API) records win: drop a flattened-text record when an API record has the same subject,
    # year and question wording. Normalised stems match even where the text export lost superscripts
    # ("x 2" and "x<sup>2</sup>" both normalise to "x2").
    api_sig = {(r["subject"], r["year"], norm(r["stem_text"])) for r in records if r["api"]}
    before = len(records)
    records = [r for r in records if r["api"] or (r["subject"], r["year"], norm(r["stem_text"])) not in api_sig]
    superseded = before - len(records)

    # Reuse a legacy (Claude-written) explanation on an officially keyed record only when the legacy key
    # agrees with the official key; also measure that agreement.
    agree = collections.Counter()
    if kairo:
        for r in records:
            if r["key_source"] != "source":
                continue
            ms = kairo.get((KAIRO_SUBJECT[r["subject"]], md5(norm(r["stem_text"]))), [])
            opts = {norm(strip_tags(o["html"])): o["key"] for o in r["options"]}
            ms = [m for m in ms if m["k"] in opts]
            if not ms:
                continue
            m = max(ms, key=lambda m: m["el"])
            if opts[m["k"]] == r["correct"]:
                agree["agree"] += 1
                if m["el"]:
                    r["explanation_legacy_id"] = m["id"]
            else:
                # MySchool's key is not JAMB's official key and can be wrong. When it disagrees with the
                # independently worked legacy key, one of them is wrong: an editor decides.
                agree["disagree"] += 1
                r["key_conflict"] = {"myschool": r["correct"], "legacy_ai": opts[m["k"]], "legacy_id": m["id"]}

    # Recover keys for keyless records from the existing kairo bank (exact stem match, same subject,
    # and the kairo key's text must equal exactly one option here).
    recovered = collections.Counter()
    for r in records:
        if r["correct"] or r["key_problem"] or not kairo:
            continue
        matches = kairo.get((KAIRO_SUBJECT[r["subject"]], md5(norm(r["stem_text"]))), [])
        hits = set()
        for m in matches:
            for o in r["options"]:
                if m["k"] and norm(strip_tags(o["html"])) == m["k"]:
                    hits.add((o["key"], m["id"], m["el"]))
        keys = {h[0] for h in hits}
        if len(keys) == 1:
            key, legacy, el = sorted(hits, key=lambda h: -h[2])[0]
            r["correct"], r["key_source"] = key, "ai_legacy"
            r["explanation_legacy_id"] = legacy if el else None
            recovered[r["subject"]] += 1
        elif len(keys) > 1:
            r["key_problem"] = "kairo matches disagree"

    # Deduplicate: same subject + same normalised stem + same option set = one question.
    # Prefer a source key, then a recovered key, then HTML-rich (older) records.
    def rank(r):
        return (r["key_source"] != "source", r["key_source"] is None, r["file"].startswith(("biology", "chemistry", "physics", "mathematics", "english")))

    groups = collections.defaultdict(list)
    for r in records:
        sig = (r["subject"], norm(r["stem_text"]), tuple(sorted(norm(strip_tags(o["html"])) for o in r["options"])))
        groups[sig].append(r)
    unique, dupes = [], 0
    for sig, rs in groups.items():
        rs.sort(key=rank)
        best = rs[0]
        best["also_in_years"] = sorted({x["year"] for x in rs[1:] if x["year"] != best["year"]})
        unique.append(best)
        dupes += len(rs) - 1

    # Canonical id, flags and status.
    for r in unique:
        r["uid"] = f"{r['subject']}-{r['year']}-{r['source_ref'] or md5(norm(r['stem_text']))[:10]}"
        img_flags = classify_image(r)
        r["flags"] = list(dict.fromkeys(img_flags + flags_for(r) + (["key_conflict"] if r.get("key_conflict") else [])))
        blocking = r["flags"]
        if not r["correct"]:
            r["status"] = "needs_key"
        elif blocking:
            r["status"] = "needs_review"
        elif r["key_source"] != "source":
            r["status"] = "ai_key"  # usable for practice; needs a human check before ranked/daily use
        else:
            r["status"] = "ready"
    unique.sort(key=lambda r: (r["subject"], r["year"], r["uid"]))

    with open(os.path.join(a.out, "questions.jsonl"), "w", encoding="utf-8") as fh:
        for r in unique:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Report.
    by_subj = collections.defaultdict(collections.Counter)
    for r in unique:
        s = by_subj[r["subject"]]
        s["unique"] += 1
        s[r["status"]] += 1
        s["key_" + (r["key_source"] or "none")] += 1
        s["with_explanation"] += bool(r["explanation_legacy_id"])
        s["official"] += r["key_source"] == "source"
        s["five_options"] += len(r["options"]) == 5
        s["with_image"] += bool(r["image_url"] or r["image_file"])
        s["with_passage"] += bool(r["passage"])
        for f in r["flags"]:
            s["flag_" + f] += 1
    years = collections.defaultdict(collections.Counter)
    for r in unique:
        years[r["subject"]][r["year"]] += 1
    report = {
        "input_records": len(records) + superseded,
        "superseded_by_official": superseded,
        "legacy_key_vs_official": agree,
        "per_file": per_file,
        "duplicates_removed": dupes,
        "unique": len(unique),
        "ai_keys_borrowed_from_kairo": recovered,
        "by_subject": by_subj,
        "status_total": collections.Counter(r["status"] for r in unique),
        "years": {s: dict(sorted(c.items())) for s, c in years.items()},
        "missing_years": {s: [y for y in range(1978, 2026) if y not in c] for s, c in years.items()},
    }
    with open(os.path.join(a.out, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=dict)
    json.dump({k: report[k] for k in ("input_records", "superseded_by_official", "legacy_key_vs_official", "duplicates_removed", "unique", "status_total",
                                       "ai_keys_borrowed_from_kairo", "missing_years")},
              sys.stdout, indent=1, default=dict)
    print()


if __name__ == "__main__":
    main()
