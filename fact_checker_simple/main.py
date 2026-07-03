"""
main.py — Entry point for the Agentic Fact-Checker

Usage:
  1. Start MongoDB locally (or point MONGO_URI to your server)
  2. Seed prompts:    python seed_prompts.py
  3. Run:             python main.py
"""

import json
from fact_checker import fact_check


SAMPLE_ARTICLE = """
The Indian government announced today that it will launch a ₹10,000 crore
fund to support AI startups. According to the Finance Minister, the first
grants will be disbursed by December 2026. The initiative aims to create
50,000 new jobs in the AI sector over the next three years.
"""


if __name__ == "__main__":
    result = fact_check(SAMPLE_ARTICLE, max_claims=3)

    print("\n📋 Raw JSON output:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
