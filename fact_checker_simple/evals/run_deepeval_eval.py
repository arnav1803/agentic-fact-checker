"""
Layer 3 — LLM-as-judge eval (DeepEval), judged by Groq.

Two metrics per claim:
  • FaithfulnessMetric — is the verdict grounded in the retrieved evidence?
  • GEval "VerdictCorrectness" — a rubric judge: given the evidence, is the
    verdict label correct and well justified?

Kept as a script (not a test_*.py) so the free `pytest` layer never triggers
these paid judge calls. See README for the pytest-native variant.

Usage:
    python evals/run_deepeval_eval.py --limit 3
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

from _pipeline import analyze_claim
from eval_groq import deepeval_groq_model

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=3)
    ap.add_argument("--sleep", type=float, default=10.0)
    args = ap.parse_args()

    from deepeval.test_case import LLMTestCase, LLMTestCaseParams
    from deepeval.metrics import FaithfulnessMetric, GEval

    model = deepeval_groq_model()
    faithfulness = FaithfulnessMetric(model=model, threshold=0.7, include_reason=True)
    correctness = GEval(
        name="VerdictCorrectness",
        criteria=("Given the evidence in the retrieval context, decide whether the "
                  "fact-check verdict in the actual output is correct and justified. "
                  "Reward verdicts that match what the evidence supports."),
        evaluation_params=[LLMTestCaseParams.INPUT,
                           LLMTestCaseParams.ACTUAL_OUTPUT,
                           LLMTestCaseParams.RETRIEVAL_CONTEXT],
        model=model,
        threshold=0.6,
    )

    rows = []
    with open(os.path.join(HERE, "dataset.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    rows = rows[: args.limit]

    results = []
    for i, row in enumerate(rows, 1):
        r = analyze_claim(row["claim"])
        tc = LLMTestCase(
            input=row["claim"],
            actual_output=f"{r['verdict']}. {r['justification']}",
            retrieval_context=[r["context"] or "no evidence"],
        )
        faithfulness.measure(tc)
        correctness.measure(tc)
        print(f"[{i}/{len(rows)}] {row['claim'][:50]}")
        print(f"    faithfulness={faithfulness.score:.2f}  correctness={correctness.score:.2f}")
        results.append({"claim": row["claim"], "verdict": r["verdict"],
                        "faithfulness": faithfulness.score,
                        "correctness": correctness.score})
        if i < len(rows):
            time.sleep(args.sleep)

    avg_f = sum(x["faithfulness"] for x in results) / len(results)
    avg_c = sum(x["correctness"] for x in results) / len(results)
    print(f"\n=== DEEPEVAL (Groq judge) ===\nmean faithfulness={avg_f:.3f}  mean correctness={avg_c:.3f}")
    with open(os.path.join(HERE, "report_deepeval.json"), "w", encoding="utf-8") as f:
        json.dump({"mean_faithfulness": avg_f, "mean_correctness": avg_c, "rows": results}, f, indent=2)
    print("Saved -> report_deepeval.json")


if __name__ == "__main__":
    main()
