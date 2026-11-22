#!/usr/bin/env python3
"""Suggest a JAMB syllabus topic for every question that has none.

Trains one classifier per subject (TF-IDF of words + character n-grams -> logistic regression) on the
~6,900 legacy kairo.questions that already carry a syllabus topic, measures held-out accuracy, then
predicts topics for the normalised bank. A prediction is accepted automatically only when the model's
confidence is above a per-subject threshold chosen so that held-out precision is >= --precision.
Everything else is written as a suggestion for an editor to confirm.

Usage:
  python3 -I tag_topics.py --labelled kairo_topics_export.json --bank questions.jsonl --out topics.json
The labelled export is the saved result of:
  select id, subject, topic, left(stem,400) stem,
         (select string_agg(e->>'text',' | ') from jsonb_array_elements(options) e) opts
  from kairo.questions where topic is not null;
"""
import argparse
import collections
import json
import re
import sys

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict
from sklearn.pipeline import FeatureUnion, make_pipeline

SUBJECT = {"Biology": "BIO", "Chemistry": "CHM", "Physics": "PHY", "Mathematics": "MTH", "Use of English": "ENG"}
RENAME = {"The Lekki Headmaster — Kabir Alabi Garba": "Set text (novel)"}   # matches the cbt.topics seed


# English topics are question types, so plain instruction-text rules beat a model.
# Order matters: the first matching rule wins.
ENG_RULES = [
    (r"gaps? numbered|passage below has gaps", "Coherence and logical reasoning"),
    (r"lekki headmaster|\bnovel\b", "Set text (novel)"),
    (r"opposite in meaning|nearest in meaning|similar in meaning|most nearly opposite|closest in meaning|same meaning as", "Synonyms/antonyms"),
    (r"vowel", "Vowels"),
    (r"consonant", "Consonants"),
    (r"emphatic stress|in capital letters has the|word in capitals", "Intonation"),
    (r"stress", "Stress"),
    (r"rhyme", "Rhymes"),
    (r"wrongly spelt|correctly spelt|spelling", "Error identification"),
    (r"silent letter|pronounced differently", "Pronunciation distinctions"),
    (r"homophone", "Homophones"),
    (r"best explains? the information|interpretation|given sentence relates|this means that", "Vocabulary and expressions in context"),
    (r"according to the passage|the passage|the writer|the author|the extract|the poem|the stanza", "Comprehension"),
    (r"fill|gap|complete", "Sentence completion"),
]


def eng_rule(stem, has_passage):
    s = (stem or "").lower()
    if has_passage and not re.search(r"gaps? numbered", s):
        return "Comprehension"
    for pat, topic in ENG_RULES:
        if re.search(pat, s):
            return topic
    return None


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def text_of(stem, opts):
    s = re.sub(r"<[^>]+>", " ", f"{stem} || {opts}")
    s = re.sub(r"\\\(|\\\)|\\frac|\\sqrt", " ", s)
    return s.lower()


def load_labelled(path):
    raw = open(path, encoding="utf-8").read()
    txt = json.loads(raw)["result"]
    rows = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
    out, by_id, by_stem = collections.defaultdict(list), {}, {}
    for r in rows:
        topic = RENAME.get(r["topic"], r["topic"])
        out[SUBJECT[r["subject"]]].append((text_of(r["stem"], r["opts"] or ""), topic))
        by_id[r["id"]] = topic
        by_stem[(SUBJECT[r["subject"]], norm(r["stem"][:400]))] = topic
    return out, by_id, by_stem


def model():
    feats = FeatureUnion([
        ("w", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True)),
        ("c", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3, sublinear_tf=True, max_features=60000)),
    ])
    return make_pipeline(feats, LogisticRegression(max_iter=2000, C=8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labelled", required=True)
    ap.add_argument("--bank", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--precision", type=float, default=0.90)
    a = ap.parse_args()

    labelled, by_id, by_stem = load_labelled(a.labelled)
    bank = [json.loads(l) for l in open(a.bank, encoding="utf-8")]
    result, report = {}, {}
    for subj, rows in sorted(labelled.items()):
        X = [t for t, _ in rows]
        y = np.array([lab for _, lab in rows])
        m = model()
        # Held-out estimate: 5-fold cross-validated probabilities.
        proba = cross_val_predict(m, X, y, cv=5, method="predict_proba")
        classes = np.unique(y)
        pred, conf = classes[proba.argmax(1)], proba.max(1)
        acc = float((pred == y).mean())
        # Lowest threshold whose accepted set reaches the target precision.
        thr = 1.0
        for t in np.arange(0.20, 0.96, 0.01):
            sel = conf >= t
            if sel.sum() and (pred[sel] == y[sel]).mean() >= a.precision:
                thr = float(t)
                break
        cover = float((conf >= thr).mean())
        m.fit(X, y)
        todo = [r for r in bank if r["subject"] == subj]
        P = m.predict_proba([text_of(r["stem_text"], " | ".join(re.sub(r"<[^>]+>", "", o["html"]) for o in r["options"])) for r in todo])
        cls = m.classes_
        src = collections.Counter()
        for r, p in zip(todo, P):
            i = int(p.argmax())
            legacy = by_id.get(r.get("explanation_legacy_id")) or by_stem.get((subj, norm(r["stem_text"][:400])))
            rule = eng_rule(r["stem_text"], bool(r.get("passage"))) if subj == "ENG" else None
            if legacy and not (subj == "ENG" and rule):      # exact match to a labelled legacy question
                rec = {"topic": legacy, "confidence": 1.0, "auto": True, "source": "legacy"}
            elif rule:
                rec = {"topic": rule, "confidence": 1.0, "auto": True, "source": "rule"}
            else:
                rec = {"topic": cls[i], "confidence": round(float(p[i]), 3), "auto": bool(p[i] >= thr), "source": "model"}
            result[r["uid"]] = rec
            src[rec["source"] + ("" if rec["auto"] else "_suggested")] += 1
        report[subj] = {"labelled": len(rows), "topics": len(classes), "heldout_accuracy": round(acc, 3),
                        "threshold": round(thr, 2), "heldout_coverage_at_threshold": round(cover, 3),
                        "bank": len(todo), "auto_accepted": sum(v for k, v in src.items() if "suggested" not in k),
                        "by_source": dict(src)}
        print(subj, report[subj], flush=True)
    json.dump({"report": report, "topics": result}, open(a.out, "w"), ensure_ascii=False)


if __name__ == "__main__":
    main()
