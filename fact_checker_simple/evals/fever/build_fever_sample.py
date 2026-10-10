"""
build_fever_sample.py — Download the FEVER dev set and draw a balanced,
reproducible sample for benchmarking the fact-checking pipeline.

FEVER (Thorne et al., 2018) is the standard fact-verification benchmark. Its
labels — SUPPORTS / REFUTES / NOT ENOUGH INFO — map 1:1 onto our pipeline's
verdicts, so no relabeling is needed. Claims are standalone sentences, which is
exactly what our pipeline expects.

Output: fever_sample.jsonl with the same schema our runner already uses:
    {"id": "...", "claim": "...", "expected_verdict": "SUPPORTS|REFUTES|NOT_ENOUGH_INFO"}

Usage:
    python evals/fever/build_fever_sample.py --per-class 100      # 300 claims
    python evals/fever/build_fever_sample.py --per-class 50 --seed 7
"""
import argparse
import json
import os
import random
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FEVER_URL = "https://fever.ai/download/fever/shared_task_dev.jsonl"
RAW_CACHE = os.path.join(HERE, "fever_dev_raw.jsonl")
OUT = os.path.join(HERE, "fever_sample.jsonl")

# FEVER label text -> our pipeline's verdict label
LABEL_MAP = {
    "SUPPORTS": "SUPPORTS",
    "REFUTES": "REFUTES",
    "NOT ENOUGH INFO": "NOT_ENOUGH_INFO",
}


def download_dev_set():
    if os.path.exists(RAW_CACHE) and os.path.getsize(RAW_CACHE) > 1_000_000:
        print(f"[cache] using {RAW_CACHE}")
        return
    print(f"[download] {FEVER_URL} ...")
    req = urllib.request.Request(FEVER_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(RAW_CACHE, "wb") as f:
        f.write(r.read())
    print(f"[download] saved {os.path.getsize(RAW_CACHE):,} bytes -> {RAW_CACHE}")


def load_raw():
    buckets = {"SUPPORTS": [], "REFUTES": [], "NOT ENOUGH INFO": []}
    with open(RAW_CACHE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            lbl = row.get("label")
            claim = (row.get("claim") or "").strip()
            # Keep only clean, self-contained sentences worth sending to live search.
            if lbl in buckets and 15 <= len(claim) <= 240:
                buckets[lbl].append({"id": f"fever-{row['id']}", "claim": claim})
    return buckets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=100,
                    help="claims sampled per class (SUPPORTS/REFUTES/NEI)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    download_dev_set()
    buckets = load_raw()
    print("[pool] available per class: " +
          ", ".join(f"{k}={len(v)}" for k, v in buckets.items()))

    rng = random.Random(args.seed)
    sample = []
    for fever_label, our_label in LABEL_MAP.items():
        pool = buckets[fever_label]
        n = min(args.per_class, len(pool))
        for row in rng.sample(pool, n):
            sample.append({"id": row["id"], "claim": row["claim"],
                           "expected_verdict": our_label})

    rng.shuffle(sample)
    with open(OUT, "w", encoding="utf-8") as f:
        for row in sample:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"[sample] wrote {len(sample)} claims -> {OUT}")
    counts = {}
    for r in sample:
        counts[r["expected_verdict"]] = counts.get(r["expected_verdict"], 0) + 1
    print("[sample] class balance: " +
          ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
