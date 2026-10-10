# -*- coding: utf-8 -*-
"""Render a confusion-matrix + per-class chart from a classification report.

Usage:
    python evals/fever/make_fever_chart.py \
        --report evals/fever/report_fever.json \
        --out    evals/fever/fever_results.png
"""
import argparse
import json
import os

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

HERE = os.path.dirname(os.path.abspath(__file__))

BLUE = "#2563EB"
INK = "#141B2E"
GREY = "#4B5563"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=os.path.join(HERE, "report_fever.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "fever_results.png"))
    args = ap.parse_args()

    with open(args.report, encoding="utf-8") as f:
        rep = json.load(f)

    labels = ["SUPPORTS", "REFUTES", "NEI"]
    cm = np.array(rep["confusion_matrix"])
    acc = rep["accuracy"]
    macro_f1 = rep["macro_f1"]
    n = int(cm.sum())

    support = cm.sum(axis=1)
    correct = np.diag(cm)
    blue_cmap = LinearSegmentedColormap.from_list("b", ["#EAF1FE", "#2563EB"])

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12})
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.6),
                                   gridspec_kw={"width_ratios": [1.15, 1]})
    fig.patch.set_facecolor("white")

    im = ax1.imshow(cm, cmap=blue_cmap, vmin=0, vmax=cm.max())
    ax1.set_title("Confusion Matrix", fontsize=15, fontweight="bold", color=INK, pad=12)
    ax1.set_xticks(range(len(labels))); ax1.set_yticks(range(len(labels)))
    ax1.set_xticklabels(labels, fontsize=11, color=INK)
    ax1.set_yticklabels(labels, fontsize=11, color=INK)
    ax1.set_xlabel("Predicted", fontsize=12, color=GREY, labelpad=8)
    ax1.set_ylabel("Actual (gold)", fontsize=12, color=GREY, labelpad=8)
    for i in range(len(labels)):
        for j in range(len(labels)):
            val = cm[i, j]
            ax1.text(j, i, str(val), ha="center", va="center",
                     fontsize=17, fontweight="bold",
                     color="white" if val > cm.max() * 0.5 else INK)
    ax1.set_xticks(np.arange(-.5, len(labels), 1), minor=True)
    ax1.set_yticks(np.arange(-.5, len(labels), 1), minor=True)
    ax1.grid(which="minor", color="white", linewidth=2)
    ax1.tick_params(which="minor", length=0)
    for spine in ax1.spines.values():
        spine.set_visible(False)

    y = np.arange(len(labels))[::-1]
    ax2.barh(y, support, color="#E5EAF3", height=0.55)
    ax2.barh(y, correct, color=BLUE, height=0.55)
    for yi, c, t in zip(y, correct, support):
        ax2.text(t + max(support) * 0.02, yi, f"{c}/{t}", va="center",
                 fontsize=12, color=INK, fontweight="bold")
    ax2.set_yticks(y); ax2.set_yticklabels(labels, fontsize=11, color=INK)
    ax2.set_xlim(0, max(support) * 1.15)
    ax2.set_xticks([])
    ax2.set_title("Correct per class", fontsize=15, fontweight="bold", color=INK, pad=12)
    for spine in ax2.spines.values():
        spine.set_visible(False)

    fig.suptitle(f"FEVER benchmark   Accuracy {acc:.1%}    Macro-F1 {macro_f1:.2f}    "
                 f"(n = {n} claims)",
                 fontsize=14, fontweight="bold", color=BLUE, y=0.02)
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(args.out, dpi=170, facecolor="white", bbox_inches="tight")
    print("Saved:", args.out)


if __name__ == "__main__":
    main()
