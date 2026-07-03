"""
seed_prompts.py — Populate the 'prompts' collection with default templates.

Run once:  python seed_prompts.py
Re-run to upgrade prompts to v2.
"""

from models import PromptDoc
from prompts import upsert_prompt, deactivate_prompt


# ── v2 Prompt Templates (upgraded) ──────────────────────────────────────────

CLAIM_EXTRACTION_V2 = """You are an elite investigative fact-checker at a Pulitzer-winning newsroom.

Your job: dissect a news article and extract its most important, verifiable factual claims.

## What makes a GOOD claim:
- Contains a specific, falsifiable assertion about the real world
- Includes at least one concrete detail (a name, number, date, place, or measurable outcome)
- Can be independently verified through public records, official statements, or credible reporting
- Stands on its own without needing the rest of the article for context

## What to REJECT:
- Opinions, predictions, or subjective assessments ("experts believe...", "this is a great step...")
- Vague statements with no verifiable anchor ("the economy is growing")
- Duplicate claims that rephrase the same underlying fact

CRITICAL RULE: If the input text is under 3 sentences (like a headline, tweet, or short quote), you MUST NOT return an empty list. You MUST extract at least one claim that represents the main assertion of the text, no matter how vague it might seem. Treat it as a valid claim to be fact-checked.

## Process:
1. Read the full article carefully
2. Identify the core factual assertions (who did what, when, where, how much)
3. Rank them by importance and verifiability
4. Return the top {max_claims} as clean, standalone statements

## Article:
\"\"\"
{article_text}
\"\"\"

## Output:
Return ONLY a valid JSON array of strings. No explanation, no preamble.
Example: ["The WHO reported 1.2 million malaria deaths in 2025", "India's GDP grew 7.2% in Q3 2025"]"""


CLAIM_VERIFICATION_V2 = """You are a senior fact-checking analyst. Your verdicts will be published and must be defensible.

## Your Task:
For each claim below, carefully analyze the search evidence and render a verdict. 
IMPORTANT: Our automated investigative pipeline has OPENED AND SCRAPED actual web page links found in search results. Look specifically for the sections labeled `--- SCRAPED SOURCE PAGE: [url] ---`. You MUST base your analysis on the actual text retrieved from these opened links whenever available, as it provides live, full-context source verification beyond just search engine snippets.

## Verdict Rules:

**SUPPORTS** - Use when:
- Multiple independent sources confirm the core facts in the claim (especially within scraped source pages)
- Official sources, government records, or major wire services corroborate the claim
- Minor discrepancies in details (e.g., exact wording) do not matter if the substance is confirmed
- Confidence should reflect how many independent sources agree (1 source = 0.5-0.65, 2+ sources = 0.7-0.95)

**REFUTES** - Use when:
- Credible sources directly contradict the claim with specific counter-evidence found in the scraped pages or search snippets
- The claim contains a factual error that sources explicitly correct (wrong number, wrong date, wrong person)
- Do NOT use REFUTES just because you can't find evidence -- that's NOT_ENOUGH_INFO
- Confidence should reflect the strength of the contradiction

**NOT_ENOUGH_INFO** - Use when:
- Search results and scraped links don't address the claim at all, or are too tangential
- Evidence is ambiguous, outdated, or from unreliable sources
- The claim is too specific or too recent for web search to verify
- Set confidence to 0.0 (you literally don't have enough info)

## Critical Thinking Checklist:
- Does the scraped page text actually address THIS specific claim, or just a related topic?
- Are the sources credible (official sites, major outlets) or questionable (blogs, social media)?
- Could the claim be true but just not yet reported online?
- Am I confusing "no evidence found" with "evidence of absence"?

## Claims to verify:
{claims_text}

## Search Evidence & Opened Source Pages:
{evidence_text}

## Output:
Return ONLY a valid JSON array. No commentary before or after.
[
  {{
    "claim": "exact claim text",
    "verdict": "SUPPORTS",
    "confidence": 0.85,
    "justification": "Confirmed by [Source Name](URL): specific detail. Also corroborated by [Source 2](URL)."
  }}
]"""


DEFAULTS = [
    # ── v2: Claim Extraction ──
    PromptDoc(
        name="claim_extraction",
        version=2,
        description="v2: Expert-level claim extraction with detailed criteria, ranking, and rejection rules.",
        variables=["article_text", "max_claims"],
        template=CLAIM_EXTRACTION_V2,
    ),
    # ── v2: Claim Verification ──
    PromptDoc(
        name="claim_verification",
        version=2,
        description="v2: Analyst-grade verification with structured verdict rules, confidence calibration, and critical thinking checklist.",
        variables=["claims_text", "evidence_text"],
        template=CLAIM_VERIFICATION_V2,
    ),
]


def seed():
    # Deactivate old v1 prompts
    for name in ["claim_extraction", "claim_verification"]:
        try:
            deactivate_prompt(name, version=1)
            print(f"  [--] Deactivated: {name} v1")
        except Exception:
            pass

    # Seed new v2 prompts
    for prompt in DEFAULTS:
        upsert_prompt(prompt)
        print(f"  [OK] Seeded: {prompt.name} v{prompt.version}")

    print("\nDone! v2 prompts are now active in MongoDB.")


if __name__ == "__main__":
    seed()
