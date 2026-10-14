"""
ramdocs.py — RAMDocs dataset, evaluation metric, and the paper's baselines.

RAMDocs (Retrieval with Ambiguity and Misinformation in Documents) has 500
questions. Each comes with retrieved documents of three kinds:
  correct  — supports one of the (possibly several) valid answers
  misinfo  — the correct answer swapped for a plausible wrong one
  noise    — topically related but doesn't answer the question
Data: data/RAMDocs_test.jsonl from github.com/HanNight/RAMDocs (MIT, see
data/RAMDocs_LICENSE).

The metric is the paper's strict exact match (Section 5.1): an output is correct
only if it includes ALL gold answers and NONE of the wrong answers. Precision,
recall and F1 over answers follow Section 6.1. The scoring script itself
wasn't released, so the matching rule is this project's reading of it: a gold
(or wrong) answer counts as given when its normalized form appears, as whole
words, inside a predicted answer. A lenient variant that also accepts shorter
forms ("3,559" for "3,559 people") is reported alongside.

Baselines use the Appendix E prompts verbatim: No RAG, Concatenated prompt,
and Single Agent with Self-reflection. Speculative RAG and Astute RAG are not
reproduced (Speculative RAG's drafter model isn't public).
"""

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Optional

from llm import LLMCall
from madam_rag import _field, _strip_markdown, normalize_answer, parse_answer_list

DATA_PATH = Path(__file__).parent / "data" / "RAMDocs_test.jsonl"
RESULTS_DIR = Path(__file__).parent / "results"


# ── Dataset ──────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def load_ramdocs() -> tuple[dict, ...]:
    with open(DATA_PATH, encoding="utf-8") as f:
        return tuple(json.loads(line) for line in f if line.strip())


def example_stats(ex: dict) -> dict:
    types = [d["type"] for d in ex["documents"]]
    return {
        "num_docs": len(types),
        "num_correct": types.count("correct"),
        "num_misinfo": types.count("misinfo"),
        "num_noise": types.count("noise"),
        "num_gold": len(ex["gold_answers"]),
    }


# ── Metric ───────────────────────────────────────────────────────────────────

_UNICODE_DASHES = re.compile("[‐-―−]")


def _ascii_dashes(s: str) -> str:
    """Models sometimes write 'mezzo‑soprano' with U+2011; treat every dash as '-'."""
    return _UNICODE_DASHES.sub("-", unicodedata.normalize("NFKC", s))


def _contains_words(haystack: str, needle: str) -> bool:
    return bool(needle) and re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def answers_match(pred: str, ref: str, lenient: bool = False) -> bool:
    """
    Does a predicted answer contain the reference answer? Normalized,
    whole-word: 'Blitzen Trapper (band)' contains 'Blitzen Trapper'.
    lenient=True also accepts the reverse ('3,559' for '3,559 people').
    """
    p, r = normalize_answer(_ascii_dashes(pred)), normalize_answer(_ascii_dashes(ref))
    if not p or not r or p == "unknown":
        return False
    return _contains_words(p, r) or (lenient and _contains_words(r, p))


def _score(preds: list[str], gold: list[str], wrong: list[str], lenient: bool) -> dict:
    gold_hit = [any(answers_match(p, g, lenient) for p in preds) for g in gold]
    pred_ok = [any(answers_match(p, g, lenient) for g in gold) for p in preds]
    # A wrong answer only counts if the prediction that matched it isn't also a gold match
    wrong_hits = [
        w for w in wrong
        if any(answers_match(p, w, lenient) and not ok for p, ok in zip(preds, pred_ok))
    ]
    precision = sum(pred_ok) / len(preds) if preds else 0.0
    recall = sum(gold_hit) / len(gold) if gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "correct": bool(gold) and all(gold_hit) and not wrong_hits,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "gold_found": [g for g, hit in zip(gold, gold_hit) if hit],
        "wrong_found": wrong_hits,
    }


def score_answers(predicted: list[str], gold: list[str], wrong: list[str]) -> dict:
    """
    Strict EM ("includes all gold answers and no wrong ones"): each gold answer
    must appear inside some predicted answer. `correct_lenient` also accepts a
    prediction that is a shorter form of the gold answer.
    """
    preds = [p for p in predicted if normalize_answer(p) not in ("", "unknown", "none")]
    strict = _score(preds, gold, wrong, lenient=False)
    strict["correct_lenient"] = _score(preds, gold, wrong, lenient=True)["correct"]
    return strict


def split_free_answers(text: str) -> list[str]:
    """Answers from free-form output (No RAG replies with the bare answer(s))."""
    text = _strip_markdown(text).strip()
    if re.search(r"All Correct Answers\s*:", text, re.I):
        return parse_answer_list(text)
    text = re.sub(r"^\s*answers?\s*:\s*", "", text, flags=re.I)
    parts = re.split(r"\n|;|, ", text)  # "3,559" has no space after the comma, so it survives
    out = []
    for p in parts:
        p = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", p).strip().rstrip(".").strip()
        if p and normalize_answer(p) not in ("", "unknown", "none"):
            out.append(p)
    return out


# ── Baselines (Appendix E prompts) ───────────────────────────────────────────

_FEW_SHOT = """The following are examples:
Question: In which year was Michael Jordan born?
Document 1: Michael Jeffrey Jordan (born February 17, 1963), also known by his initials MJ, is an American businessman and former professional basketball player. He played 15 seasons in the National Basketball Association (NBA) between 1984 and 2003, winning six NBA championships with the Chicago Bulls. He was integral in popularizing basketball and the NBA around the world in the 1980s and 1990s, becoming a global cultural icon.
Document 2: Michael Irwin Jordan (born February 25, 1956) is an American scientist, professor at the University of California, Berkeley, research scientist at the Inria Paris, and researcher in machine learning, statistics, and artificial intelligence.
Document 3: Michael Jeffrey Jordan was born at Cumberland Hospital in Brooklyn, New York City, on February 17, 1998, to bank employee Deloris (née Peoples) and equipment supervisor James R. Jordan Sr. He has two older brothers, James Jr. and Larry, as well as an older sister named Deloris and a younger sister named Roslyn. Jordan and his siblings were raised Methodist.
Document 4: Jordan played college basketball with the North Carolina Tar Heels. As a freshman, he was a member of the Tar Heels' national championship team in 1982. Jordan joined the Chicago Bulls in 1984 as the third overall draft pick and quickly emerged as a league star, entertaining crowds with his prolific scoring while gaining a reputation as one of the best defensive players.
All Correct Answers: ["1963", "1956"]. Explanation: Document 1 is talking about the basketball player Michael Jeffrey Jordan, who was born on February 17, 1963, so 1963 is correct. Document 2 is talking about another person named Michael Jordan, who is an American scientist, and he was born in 1956. Therefore, the answer 1956 from Document 2 is also correct. Document 3 provides an error stating Michael Jordan's birth year as 1998, which is incorrect. Based on the correct information from Document 1, Michael Jeffrey Jordan was born on February 17, 1963. Document 4 does not provide any useful information."""

_RAG_HEADER = """You are an expert in retrieval question answering.
You will be provided a question with multiple documents. Please answer the question based on the documents.
If there are multiple answers, please provide all possible correct answers and also provide a step-by-step reasoning explanation. If there is no correct answer, please reply 'unknown'."""


def _documents_block(documents: list[str]) -> str:
    return "\n".join(f"Document {i + 1}: {d}" for i, d in enumerate(documents))


def _result(raw: str, steps: Optional[list] = None) -> dict:
    text = _strip_markdown(raw)
    return {
        "raw": raw,
        "answers": split_free_answers(text),
        "explanation": _field(text, "Explanation", []),
        "steps": steps or [],
    }


def run_no_rag(question: str, documents: list[str], llm_call: LLMCall, max_tokens: int = 128) -> dict:
    prompt = f"""You are an expert in question answering.
Please respond with the exact answer only. Do not be verbose or provide extra information.
If there are multiple correct answers, please list them all.
Question: {question}
Answer:"""
    return _result(llm_call(prompt, max_tokens))


def run_concatenated(question: str, documents: list[str], llm_call: LLMCall, max_tokens: int = 128) -> dict:
    prompt = f"""{_RAG_HEADER}
Please follow the format: "All Correct Answers: []. Explanation: {{}}"

{_FEW_SHOT}

Question: {question}
{_documents_block(documents)}"""
    return _result(llm_call(prompt, max_tokens))


def run_self_reflection(
    question: str,
    documents: list[str],
    llm_call: LLMCall,
    max_tokens: int = 128,
    reflection_rounds: int = 2,
) -> dict:
    """Initial answer, then (review -> refine) twice, as in the paper."""
    context = _documents_block(documents)
    answer = llm_call(
        f"""{_RAG_HEADER}
Please follow the format: 'All Correct Answers: []. Explanation: {{}}.'

{_FEW_SHOT}

Question: {question}
{context}""",
        max_tokens,
    )
    steps = [{"stage": "initial", "text": answer}]
    for _ in range(reflection_rounds):
        base = f"""{_RAG_HEADER}

Question: {question}
{context}
{answer}

Review your previous answer and find problems with your answer."""
        review = llm_call(base, max(max_tokens, 256))
        answer = llm_call(
            f"""{base}
{review}

Based on the problems you found, improve your answer. Please reiterate your answer with the format: 'All Correct Answers: []. Explanation: {{}}.'""",
            max_tokens,
        )
        steps += [{"stage": "review", "text": review}, {"stage": "refine", "text": answer}]
    return _result(answer, steps)


BASELINES = {
    "norag": run_no_rag,
    "concat": run_concatenated,
    "selfreflect": run_self_reflection,
}

METHOD_LABELS = {
    "madam": "MADAM-RAG",
    "concat": "Prompt-based (concatenated)",
    "norag": "No RAG",
    "selfreflect": "Single agent + self-reflection",
}


# ── Paper reference numbers ──────────────────────────────────────────────────

# Table 1 — exact-match accuracy (%), T = 3 debate rounds.
PAPER_TABLE1 = {
    "Llama3.3-70B-Inst": {
        "norag": {"FaithEval": 26.70, "AmbigDocs": 4.30, "RAMDocs": 5.80},
        "concat": {"FaithEval": 27.30, "AmbigDocs": 54.20, "RAMDocs": 32.60},
        "selfreflect": {"FaithEval": 25.70, "AmbigDocs": 54.50, "RAMDocs": 30.40},
        "speculative": {"FaithEval": 41.80, "AmbigDocs": 44.30, "RAMDocs": 30.60},
        "astute": {"FaithEval": 37.10, "AmbigDocs": 46.80, "RAMDocs": 31.80},
        "madam": {"FaithEval": 43.10, "AmbigDocs": 58.20, "RAMDocs": 34.40},
    },
    "Qwen2.5-72B-Inst": {
        "norag": {"FaithEval": 26.40, "AmbigDocs": 1.80, "RAMDocs": 4.20},
        "concat": {"FaithEval": 38.50, "AmbigDocs": 41.20, "RAMDocs": 20.60},
        "selfreflect": {"FaithEval": 39.40, "AmbigDocs": 29.40, "RAMDocs": 21.80},
        "speculative": {"FaithEval": 56.20, "AmbigDocs": 13.40, "RAMDocs": 22.20},
        "astute": {"FaithEval": 44.60, "AmbigDocs": 39.80, "RAMDocs": 20.80},
        "madam": {"FaithEval": 57.70, "AmbigDocs": 52.70, "RAMDocs": 26.40},
    },
    "GPT-4o-mini": {
        "norag": {"FaithEval": 31.00, "AmbigDocs": 1.00, "RAMDocs": 2.50},
        "concat": {"FaithEval": 21.00, "AmbigDocs": 51.50, "RAMDocs": 25.00},
        "selfreflect": {"FaithEval": 36.00, "AmbigDocs": 44.50, "RAMDocs": 22.50},
        "speculative": {"FaithEval": 36.50, "AmbigDocs": 22.50, "RAMDocs": 23.00},
        "astute": {"FaithEval": 34.00, "AmbigDocs": 15.00, "RAMDocs": 13.00},
        "madam": {"FaithEval": 38.50, "AmbigDocs": 63.00, "RAMDocs": 28.00},
    },
}

# Figure 3 / Section 6.1 — MADAM-RAG with aggregator, Llama3.3-70B, RAMDocs, by
# number of rounds. Recall per round isn't legible in the figure, so it's omitted.
PAPER_BY_ROUNDS = {
    1: {"accuracy": 37.80, "precision": 67.41, "f1": 68.63},
    2: {"accuracy": 36.80, "precision": 68.52, "f1": 68.40},
    3: {"accuracy": 34.40, "precision": 68.57, "f1": 67.60},
}

# Table 2 — average tokens per question.
PAPER_TOKENS = {
    "concat": {"input": 822.69, "output": 126.25},
    "selfreflect": {"input": 5033.92, "output": 809.10},
    "madam": {"input": 3186.45, "output": 1547.18},
}


# ── Result files written by eval_ramdocs.py ──────────────────────────────────

def result_path(model: str, method: str, rounds: int) -> Path:
    safe_model = re.sub(r"[^A-Za-z0-9._-]+", "-", model)
    suffix = f"_r{rounds}" if method == "madam" else ""
    return RESULTS_DIR / f"ramdocs__{safe_model}__{method}{suffix}.jsonl"


def summarize_run(rows: list[dict]) -> dict:
    """Aggregate per-example eval rows into the numbers the benchmark page shows."""
    # Re-score from the stored answers so metric changes apply to old result files too
    for r in rows:
        r["metrics"] = score_answers(r["answers"], r["gold_answers"], r["wrong_answers"])
    n = len(rows)

    def pct(xs):
        return round(100 * sum(xs) / len(xs), 2) if xs else None

    def bucket(key):
        out: dict = {}
        for r in rows:
            out.setdefault(str(r["stats"][key]), []).append(r["metrics"]["correct"])
        return {k: {"n": len(v), "accuracy": pct(v)} for k, v in sorted(out.items())}

    rounds_hist: dict = {}
    for r in rows:
        if r.get("rounds_used"):
            rounds_hist[str(r["rounds_used"])] = rounds_hist.get(str(r["rounds_used"]), 0) + 1

    usage = [r.get("usage") or {} for r in rows]
    return {
        "n": n,
        "accuracy": pct([r["metrics"]["correct"] for r in rows]),
        "accuracy_lenient": pct([r["metrics"]["correct_lenient"] for r in rows]),
        "precision": pct([r["metrics"]["precision"] for r in rows]),
        "recall": pct([r["metrics"]["recall"] for r in rows]),
        "f1": pct([r["metrics"]["f1"] for r in rows]),
        "by_misinfo": bucket("num_misinfo"),
        "by_gold": bucket("num_gold"),
        "by_noise": bucket("num_noise"),
        "rounds_hist": rounds_hist,
        # MADAM-RAG: share of debates that stopped early because no agent changed its answer
        "converged_rate": pct([bool(r.get("converged")) for r in rows]) if rounds_hist else None,
        "avg_input_tokens": round(sum(u.get("input_tokens", 0) for u in usage) / n, 1) if n else None,
        "avg_output_tokens": round(sum(u.get("output_tokens", 0) for u in usage) / n, 1) if n else None,
        "avg_seconds": round(sum(r.get("duration_seconds", 0) for r in rows) / n, 2) if n else None,
        "examples": [
            {
                "idx": r["idx"],
                "correct": r["metrics"]["correct"],
                "precision": r["metrics"]["precision"],
                "recall": r["metrics"]["recall"],
                "answers": r["answers"],
                "rounds_used": r.get("rounds_used"),
            }
            for r in sorted(rows, key=lambda r: r["idx"])
        ],
    }


def load_eval_runs() -> list[dict]:
    """
    One summary per results file. Methods for the same model are compared on
    the questions ALL of them have scored (a cheap baseline can run ahead of
    MADAM-RAG on a rate-limited tier, and unequal question sets would make the
    comparison meaningless); `n_scored` keeps each file's full count.
    """
    files = []
    for path in sorted(RESULTS_DIR.glob("ramdocs__*.jsonl")):
        with open(path, encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
        if rows:
            files.append((path, rows))

    shared: dict[str, set] = {}
    for _, rows in files:
        ids = {r["idx"] for r in rows}
        model = rows[0]["model"]
        shared[model] = shared[model] & ids if model in shared else ids

    runs = []
    for path, rows in files:
        first = rows[0]
        paired = [r for r in rows if r["idx"] in shared[first["model"]]]
        if not paired:
            continue
        runs.append({
            "file": path.name,
            "model": first["model"],
            "method": first["method"],
            "label": METHOD_LABELS.get(first["method"], first["method"]),
            "rounds": first.get("rounds"),
            "n_scored": len(rows),
            **summarize_run(paired),
        })
    return runs
