# Evaluation Suite

A three-layer eval strategy for the Agentic Fact-Checker, built on standard
frameworks. All judge-based evals use **Groq** as the judge LLM, so no OpenAI
key is required.

| Layer | Framework | What it checks | LLM cost |
|---|---|---|---|
| 1. Deterministic | **pytest** | Pure logic: scoring, verdict label, binary/JSON sanitisation | none |
| 2. Classification | **scikit-learn** | Verdict accuracy, per-class P/R/F1, confusion matrix (FEVER-style) | pipeline runs |
| 3. LLM-as-judge | **DeepEval** | Faithfulness (groundedness) + G-Eval rubric on verdict correctness | pipeline + judge |

## Setup
```bash
pip install -r evals/requirements-eval.txt
```
Run everything **from the `fact_checker_simple/` directory** (so `.env` and the
modules resolve). The backend does not need to be running — the evals import the
pipeline directly — but MongoDB and the Groq/search keys must be configured.

## Layer 1 — deterministic (free, instant, CI-friendly)
```bash
pytest evals/test_deterministic.py -v
```
`pytest` only collects `test_*.py`, so it never triggers the paid layers below.

## Layer 2 — classification metrics (scikit-learn)
```bash
python evals/run_classification_eval.py --limit 4      # quick smoke
python evals/run_classification_eval.py                # full dataset
```
Prints accuracy, macro-F1, a per-class report and a confusion matrix; writes
`report_classification.json`. Labels are the FEVER three: SUPPORTS / REFUTES /
NOT_ENOUGH_INFO. Gold labels live in `dataset.jsonl` (extend it freely).

## Layer 3 — DeepEval (Groq judge)
```bash
python evals/run_deepeval_eval.py --limit 3
```
`FaithfulnessMetric` + a `GEval` "VerdictCorrectness" rubric. Writes
`report_deepeval.json`.

### Making DeepEval pytest-native (optional, for CI)
```python
from deepeval import assert_test
def test_faithful(model, tc, metric):
    assert_test(tc, [metric])
```
Keep such tests in a separate `test_llm_*.py` and gate them behind a marker
(`pytest -m llm`) so the free layer stays fast.

## Notes on Groq free-tier limits
The judge calls add load on top of the pipeline. Use `--limit` and `--sleep`
to stay under the 12k tokens/min cap; raise the tier for the full dataset.
`dataset.jsonl` ships with 12 labeled claims (5 true / 5 false / 2 unverifiable)
— add your own or import a FEVER sample for a larger benchmark.
