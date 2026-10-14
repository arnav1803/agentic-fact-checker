"""
eval_ramdocs.py — Replicate the paper's RAMDocs results (Table 1) with Groq.

    python eval_ramdocs.py --sample 30                      # MADAM-RAG + baselines, random 30
    python eval_ramdocs.py --sample 100                     # grow the same sample (results append)
    python eval_ramdocs.py --methods madam --rounds 3 --sample 50
    python eval_ramdocs.py --summary                        # print results so far

Questions are drawn as a prefix of one fixed shuffle (--seed), so a bigger
--sample keeps every question already scored. Don't evaluate the first N
questions of the file instead: RAMDocs_test.jsonl is sorted by the number of
valid answers, so its first ~100 questions have exactly one answer and none
of the ambiguity the paper is about. (--offset/--limit still exist for that,
e.g. debugging one question.)

One JSONL file per (model, method[, rounds]) goes in results/; questions
already scored are skipped, so a run can be stopped and resumed, or spread
over several days on a free tier. `--summary` prints the comparison with the
paper.

Cost: the paper reports ~3.2k input + 1.5k output tokens per question for
MADAM-RAG at T=3 (Table 2). Groq's free tier for llama-3.3-70b-versatile allows
about 100k tokens a day, so expect ~20-30 questions/day for MADAM-RAG there.
Scores on a slice are not directly comparable to the paper's 500-question
numbers; the summary prints n alongside every figure.
"""

import argparse
import json
import random
import sys
import time

from config import MADAM_MODEL
from llm import DailyLimitError, Usage, make_llm_call
from madam_rag import DEFAULT_ROUNDS, MAX_ROUNDS, QATask, debate
from ramdocs import (
    BASELINES,
    METHOD_LABELS,
    PAPER_BY_ROUNDS,
    PAPER_TABLE1,
    RESULTS_DIR,
    example_stats,
    load_eval_runs,
    load_ramdocs,
    result_path,
    score_answers,
)

ALL_METHODS = ["madam", "concat", "norag", "selfreflect"]


def run_one(method: str, ex: dict, model: str, rounds: int, shuffle: bool, concurrency: int) -> dict:
    usage = Usage()
    call = make_llm_call(model, usage=usage)
    docs = [d["text"] for d in ex["documents"]]
    started = time.time()
    row: dict = {}
    if method == "madam":
        record = debate(QATask(ex["question"]), docs, call,
                        num_rounds=rounds, shuffle=shuffle, concurrency=concurrency)
        final = record.get("final") or {}
        answers, raw = final.get("answers", []), final.get("raw", "")
        row = {"rounds_used": record["rounds_used"], "converged": record["converged"], "record": record}
    else:
        out = BASELINES[method](ex["question"], docs, call)
        answers, raw = out["answers"], out["raw"]
        row = {"steps": out["steps"]}
    return {
        "answers": answers,
        "raw": raw,
        "metrics": score_answers(answers, ex["gold_answers"], ex["wrong_answers"]),
        "usage": usage.to_dict(),
        "duration_seconds": round(time.time() - started, 2),
        **row,
    }


def print_summary(rounds_filter=None) -> None:
    runs = load_eval_runs()
    if not runs:
        print("No results yet in", RESULTS_DIR)
        return
    paper = PAPER_TABLE1["Llama3.3-70B-Inst"]
    print("\nEach model's methods are compared on the questions all of them have scored (n).")
    print(f"\n{'method':<34}{'model':<28}{'n':>5}{'acc':>8}{'P':>8}{'R':>8}{'F1':>8}   paper acc")
    print("-" * 112)
    for r in runs:
        label = r["label"] + (f" (T={r['rounds']})" if r["method"] == "madam" else "")
        if r["method"] == "madam" and r["rounds"] in PAPER_BY_ROUNDS:
            ref = f"{PAPER_BY_ROUNDS[r['rounds']]['accuracy']:.1f} (Fig.3, T={r['rounds']})"
        else:
            ref = f"{paper.get(r['method'], {}).get('RAMDocs', float('nan')):.1f} (Table 1)"
        print(f"{label:<34}{r['model']:<28}{r['n']:>5}{r['accuracy']:>8.1f}{r['precision']:>8.1f}"
              f"{r['recall']:>8.1f}{r['f1']:>8.1f}   {ref}")
    print("\nPaper numbers are over all 500 questions with Llama3.3-70B-Instruct.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--methods", default=",".join(ALL_METHODS),
                    help=f"comma-separated subset of {ALL_METHODS}")
    ap.add_argument("--sample", type=int, default=30,
                    help="random questions to run, a prefix of one seeded shuffle (500 = full set)")
    ap.add_argument("--seed", type=int, default=42, help="shuffle seed for --sample")
    ap.add_argument("--offset", type=int, default=None,
                    help="run questions in file order from here instead of sampling")
    ap.add_argument("--limit", type=int, default=25, help="with --offset: how many questions")
    ap.add_argument("--rounds", type=int, default=DEFAULT_ROUNDS, choices=range(1, MAX_ROUNDS + 1),
                    help=f"MADAM-RAG debate rounds (paper: 3, default here: {DEFAULT_ROUNDS})")
    ap.add_argument("--model", default=MADAM_MODEL)
    ap.add_argument("--shuffle", action="store_true", help="shuffle agents before aggregation")
    ap.add_argument("--concurrency", type=int, default=1, help="parallel agent calls per round")
    ap.add_argument("--summary", action="store_true", help="only print the results so far")
    args = ap.parse_args()

    if args.summary:
        print_summary()
        return 0

    methods = [m.strip() for m in args.methods.split(",") if m.strip()]
    bad = [m for m in methods if m not in ALL_METHODS]
    if bad:
        ap.error(f"unknown methods: {bad}")

    data = load_ramdocs()
    if args.offset is not None:
        indices = list(range(args.offset, min(len(data), args.offset + args.limit)))
    else:
        order = list(range(len(data)))
        random.Random(args.seed).shuffle(order)
        indices = order[: args.sample]
    RESULTS_DIR.mkdir(exist_ok=True)

    for method in methods:
        path = result_path(args.model, method, args.rounds)
        done = set()
        if path.exists():
            with open(path, encoding="utf-8") as f:
                done = {json.loads(line)["idx"] for line in f if line.strip()}
        todo = [i for i in indices if i not in done]
        print(f"\n== {METHOD_LABELS[method]}: {len(todo)} to run, {len(done)} already in {path.name}")

        correct = 0
        for k, idx in enumerate(todo, 1):
            ex = data[idx]
            try:
                out = run_one(method, ex, args.model, args.rounds, args.shuffle, args.concurrency)
            except KeyboardInterrupt:
                print("\nStopped; finished questions are saved. Re-run to resume.")
                return 130
            except DailyLimitError as e:
                # Every remaining call would fail too, whatever the method.
                print(f"   [{idx}] {e}\nStopping all methods; re-run later to resume.")
                print_summary()
                return 2
            except Exception as e:
                print(f"   [{idx}] failed: {str(e)[:200]}\nSkipping the rest of this method.")
                break
            row = {
                "idx": idx, "method": method, "model": args.model,
                "rounds": args.rounds if method == "madam" else None,
                "question": ex["question"], "gold_answers": ex["gold_answers"],
                "wrong_answers": ex["wrong_answers"], "stats": example_stats(ex), **out,
            }
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            correct += out["metrics"]["correct"]
            mark = "OK " if out["metrics"]["correct"] else "-- "
            print(f"   {mark}[{idx}] ({k}/{len(todo)}) {ex['question'][:60]!r} -> {out['answers']} "
                  f"| gold {ex['gold_answers']} | {out['usage']['input_tokens']}+"
                  f"{out['usage']['output_tokens']} tok")
        if todo:
            print(f"   this run: {correct}/{len(todo)} correct")

    print_summary()
    return 0


if __name__ == "__main__":
    sys.exit(main())
