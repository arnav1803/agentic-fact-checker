# -*- coding: utf-8 -*-
"""
sweep_abstention.py — Study calibrated abstention offline.

Reads a checkpoint (.partial.jsonl) whose records carry a `raw_verdict` and a
`sufficiency` score, then re-derives predictions for a range of abstention
thresholds tau WITHOUT re-running the pipeline:

    final = NOT_ENOUGH_INFO   if raw_verdict in {SUPPORTS,REFUTES} and sufficiency < tau
    final = raw_verdict       otherwise

For each tau it reports 3-class accuracy, macro-F1, and per-class recall, so we
can pick the operating point and plot the risk-coverage tradeoff for the paper.

Usage:
    python evals/fever/sweep_abstention.py \
        --checkpoint evals/fever/report_fever_abstain.json.partial.jsonl
"""
import argparse
import json
import os

from sklearn.metrics import accuracy_score, f1_score, confusion_matrix

LABELS = ["SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO"]
HERE = os.path.dirname(os.path.abspath(__file__))


def derive(rows, tau):
    y_true, y_pred = [], []
    for r in rows:
        gold = r["gold"]
        raw = r.get("raw_verdict") or r.get("raw_pred") or r["pred"]
        suff = r.get("sufficiency")
        final = raw
        if tau > 0 and suff is not None and raw in ("SUPPORTS", "REFUTES") and suff < tau:
            final = "NOT_ENOUGH_INFO"
        if final not in LABELS:
            final = "NOT_ENOUGH_INFO"
        y_true.append(gold)
        y_pred.append(final)
    return y_true, y_pred


def per_class_recall(y_true, y_pred):
    cm = confusion_matrix(y_true, y_pred, labels=LABELS)
    out = {}
    for i, lbl in enumerate(LABELS):
        tot = cm[i].sum()
        out[lbl] = (cm[i][i] / tot) if tot else 0.0
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint",
                    default=os.path.join(HERE, "report_fever_abstain.json.partial.jsonl"))
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(args.checkpoint, encoding="utf-8") if l.strip()]
    have_suff = sum(1 for r in rows if r.get("sufficiency") is not None)
    print(f"Loaded {len(rows)} claims  ({have_suff} carry a sufficiency score)\n")

    thresholds = [0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    print(f"{'tau':>5} | {'acc':>6} | {'macroF1':>7} | "
          f"{'S_rec':>6} {'R_rec':>6} {'NEI_rec':>7} | {'%abstain':>8}")
    print("-" * 66)
    best = None
    for tau in thresholds:
        y_true, y_pred = derive(rows, tau)
        acc = accuracy_score(y_true, y_pred)
        mf1 = f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0)
        rec = per_class_recall(y_true, y_pred)
        abstain_rate = sum(1 for p in y_pred if p == "NOT_ENOUGH_INFO") / len(y_pred)
        print(f"{tau:>5.2f} | {acc:>6.3f} | {mf1:>7.3f} | "
              f"{rec['SUPPORTS']:>6.2f} {rec['REFUTES']:>6.2f} {rec['NOT_ENOUGH_INFO']:>7.2f} | "
              f"{abstain_rate:>7.0%}")
        if best is None or mf1 > best[1]:
            best = (tau, mf1, acc)

    print("-" * 66)
    print(f"Best macro-F1 at tau={best[0]:.2f}: macro-F1={best[1]:.3f}, acc={best[2]:.3f}")
    print("\n(tau=0.00 row is the baseline with abstention OFF.)")


if __name__ == "__main__":
    main()
