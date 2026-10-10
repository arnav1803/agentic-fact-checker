"""
Layer 2 — Classification eval (scikit-learn).

Runs the real pipeline over the labeled dataset and scores the verdicts as a
3-class problem (SUPPORTS / REFUTES / NOT_ENOUGH_INFO) — exactly the FEVER task.
Reports accuracy, per-class precision / recall / F1, macro-F1 and a confusion
matrix, and saves a JSON report.

Usage:
    python evals/run_classification_eval.py                 # full dataset
    python evals/run_classification_eval.py --limit 4       # quick smoke
    python evals/run_classification_eval.py --sleep 8       # pace Groq free tier
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
except Exception:
    pass

from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix, f1_score,
)
from _pipeline import analyze_claim

LABELS = ["SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO"]
HERE = os.path.dirname(os.path.abspath(__file__))


def load_dataset(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=os.path.join(HERE, "dataset.jsonl"),
                    help="path to a .jsonl with {claim, expected_verdict} rows")
    ap.add_argument("--out", default=os.path.join(HERE, "report_classification.json"),
                    help="where to write the JSON report")
    ap.add_argument("--limit", type=int, default=0, help="only first N claims")
    ap.add_argument("--sleep", type=float, default=6.0, help="seconds between claims")
    args = ap.parse_args()

    rows = load_dataset(args.dataset)
    if args.limit:
        rows = rows[: args.limit]
    print(f"Dataset: {args.dataset}")

    # ── Checkpoint / resume ──────────────────────────────────────────────
    # A long FEVER run can hit Groq rate limits or be interrupted, so every
    # per-claim result is appended to a .partial.jsonl. Re-running skips the
    # ids already done, so no progress is ever lost.
    ckpt = args.out + ".partial.jsonl"
    done = {}
    if os.path.exists(ckpt):
        with open(ckpt, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    d = json.loads(line)
                    done[d["id"]] = d
        print(f"[resume] found {len(done)} completed claims in {ckpt}")

    details = list(done.values())
    print(f"Running classification eval on {len(rows)} claims "
          f"({len(rows) - len(done)} remaining) ...\n")
    with open(ckpt, "a", encoding="utf-8") as ck:
        for i, row in enumerate(rows, 1):
            rid = row.get("id")
            if rid in done:
                continue
            claim, gold = row["claim"], row["expected_verdict"]
            try:
                res = analyze_claim(claim)
                pred = res["verdict"]
            except Exception as e:
                pred = "ERROR"
                res = {"confidence": 0.0, "justification": str(e)}
            ok = "OK " if pred == gold else "XX "
            print(f"[{i}/{len(rows)}] {ok} gold={gold:<16} pred={pred:<16} :: {claim[:55]}")
            rec = {"id": rid, "claim": claim, "gold": gold,
                   "pred": pred if pred in LABELS else "NOT_ENOUGH_INFO",
                   "raw_pred": pred,
                   "raw_verdict": res.get("raw_verdict", pred),
                   "sufficiency": res.get("sufficiency"),
                   "confidence": res.get("confidence")}
            # Only persist real verdicts. Transient failures (rate limit,
            # network) stay unrecorded so a re-run retries them instead of
            # freezing them as a wrong answer.
            if pred in LABELS:
                ck.write(json.dumps(rec, ensure_ascii=False) + "\n")
                ck.flush()
                details.append(rec)
            else:
                print(f"      [transient error, will retry on re-run] {res.get('justification','')[:80]}")
            if i < len(rows):
                time.sleep(args.sleep)

    y_true = [d["gold"] for d in details]
    y_pred = [d["pred"] if d["pred"] in LABELS else "NOT_ENOUGH_INFO" for d in details]

    acc = accuracy_score(y_true, y_pred)
    macro_f1 = f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0)
    report = classification_report(y_true, y_pred, labels=LABELS, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=LABELS)

    print("\n" + "=" * 60)
    print("  CLASSIFICATION RESULTS")
    print("=" * 60)
    print(f"Accuracy : {acc:.3f}")
    print(f"Macro-F1 : {macro_f1:.3f}\n")
    print(report)
    print("Confusion matrix (rows = gold, cols = pred):")
    print("            " + "  ".join(f"{l[:5]:>7}" for l in LABELS))
    for lbl, r in zip(LABELS, cm):
        print(f"{lbl:>16}  " + "  ".join(f"{v:>7}" for v in r))

    out = args.out
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"accuracy": acc, "macro_f1": macro_f1,
                   "labels": LABELS, "confusion_matrix": cm.tolist(),
                   "details": details}, f, indent=2)
    print(f"\nSaved report -> {out}")


if __name__ == "__main__":
    main()
