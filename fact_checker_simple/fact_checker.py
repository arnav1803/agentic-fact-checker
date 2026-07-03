"""
fact_checker.py — Core agentic fact-checking pipeline

Pipeline:
  1. Extract claims from article  (LLM + prompt from MongoDB)
  2. Search evidence per claim    (DuckDuckGo + MongoDB cache)
  3. Verify claims vs evidence    (LLM + prompt from MongoDB)
  4. Compute credibility score
  5. Persist full result to MongoDB
"""

import sys
import json
import re
import hashlib
import time
from datetime import datetime, timedelta, timezone

from langchain_groq import ChatGroq
from langchain_community.utilities import SerpAPIWrapper
from langchain_community.tools.tavily_search import TavilySearchResults

from config import (
    GROQ_MODEL, GROQ_TEMPERATURE, GROQ_MAX_TOKENS,
    SEARCH_NUM_RESULTS, SEARCH_CACHE_TTL_HOURS, SEARCH_DELAY_SECONDS, SERPAPI_API_KEY, TAVILY_API_KEY
)
from db import fact_checks_col, search_cache_col
from models import FactCheckResult, EvidenceItem, VerdictItem, SearchCacheDoc
from prompts import get_active_prompt


# ── LLM & Search tool ───────────────────────────────────────────────────────

llm = ChatGroq(
    model=GROQ_MODEL,
    temperature=GROQ_TEMPERATURE,
    max_tokens=GROQ_MAX_TOKENS,
)

import os
os.environ["SERPAPI_API_KEY"] = SERPAPI_API_KEY
os.environ["TAVILY_API_KEY"] = TAVILY_API_KEY

import urllib.request
import urllib.error

def _scrape_url(url: str) -> str:
    """Open a search result link, download the page, strip HTML, return clean text."""
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read()
            # Try utf-8, fall back to latin-1
            try:
                html = raw.decode('utf-8')
            except UnicodeDecodeError:
                html = raw.decode('latin-1', errors='ignore')
            # Strip scripts, styles, nav, footer, header tags
            for tag in ['script', 'style', 'nav', 'footer', 'header', 'aside']:
                html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', html, flags=re.DOTALL | re.IGNORECASE)
            # Strip all remaining HTML tags
            text = re.sub(r'<[^>]+>', ' ', html)
            # Collapse whitespace
            clean_text = ' '.join(text.split())
            # Return up to 2500 chars of clean content
            return clean_text[:2500]
    except Exception as e:
        print(f"         [SCRAPE FAIL] {url[:60]}... -> {e}")
        return ""

class SearchTool:
    def __init__(self):
        self.serp = SerpAPIWrapper(serpapi_api_key=SERPAPI_API_KEY) if SERPAPI_API_KEY else None
        self.tavily = TavilySearchResults(max_results=SEARCH_NUM_RESULTS) if TAVILY_API_KEY else None
        try:
            from langchain_community.tools import DuckDuckGoSearchResults
            self.ddg = DuckDuckGoSearchResults(max_results=SEARCH_NUM_RESULTS)
        except Exception:
            self.ddg = None
    
    def invoke(self, query: str) -> str:
        search_output = ""
        if self.serp:
            try:
                res = self.serp.run(query)
                if res and "No good search result found" not in str(res):
                    search_output = str(res)
            except Exception as e:
                print(f"      [WARN] SerpAPI failed: {e}")
        
        if not search_output and self.tavily:
            try:
                res = self.tavily.invoke(query)
                if res:
                    search_output = str(res)
            except Exception as e:
                print(f"      [WARN] Tavily failed: {e}")
                
        if not search_output and self.ddg:
            try:
                res = self.ddg.invoke(query)
                if res:
                    search_output = str(res)
            except Exception as e:
                print(f"      [WARN] DuckDuckGo failed: {e}")
        
        if not search_output:
            return "No search results found."

        # ── Deep Scraping: open the top links and read their full page content ──
        urls = re.findall(r'https?://[^\s,\'"\)\]]+', search_output)
        # Deduplicate while preserving order
        seen = set()
        unique_urls = []
        for u in urls:
            # Strip trailing punctuation
            u = u.rstrip('.,:;')
            if u not in seen and not any(ext in u for ext in ['.pdf', '.jpg', '.png', '.gif', '.mp4']):
                seen.add(u)
                unique_urls.append(u)
        
        scraped_sections = []
        for url in unique_urls[:3]:  # Open top 3 unique links
            print(f"      -> OPENING LINK: {url[:80]}")
            content = _scrape_url(url)
            if len(content) > 150:
                print(f"         ✓ Scraped {len(content)} chars of page content")
                scraped_sections.append(
                    f"--- SCRAPED SOURCE PAGE: {url} ---\n"
                    f"Below is the actual text content read from this web page:\n"
                    f"{content}"
                )
            else:
                print(f"         ✗ Page returned insufficient content, skipping")
        
        if scraped_sections:
            full_output = (
                search_output 
                + "\n\n========== DEEP WEB VERIFICATION: OPENED AND READ THE FOLLOWING PAGES ==========\n\n" 
                + "\n\n".join(scraped_sections)
            )
            return full_output
        return search_output

search_tool = SearchTool()


# ── Utilities ────────────────────────────────────────────────────────────────

def _sha256(text: str) -> str:
    return hashlib.sha256(text.strip().encode()).hexdigest()


def _parse_json(text: str):
    """Robustly extract JSON from LLM output."""
    # Strip markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```", "", text)
    text = text.strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find JSON array or object
    for pattern in [r"\[.*\]", r"\{.*\}"]:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Could not parse JSON from LLM response:\n{text[:500]}")


# ── Step 1: Extract claims ──────────────────────────────────────────────────

def extract_claims(article_text: str, max_claims: int = 5) -> list[str]:
    """Use LLM to extract atomic, verifiable claims from article text."""
    template = get_active_prompt("claim_extraction")
    prompt = template.format(article_text=article_text.strip(), max_claims=max_claims)

    response = llm.invoke(prompt)
    claims = _parse_json(response.content)

    if not isinstance(claims, list) or not all(isinstance(c, str) for c in claims):
        raise ValueError(f"Expected list[str], got: {type(claims)}")

    print(f"\n[OK] Extracted {len(claims)} claims:")
    for i, c in enumerate(claims, 1):
        print(f"   {i}. {c}")
    return claims


# ── Step 2: Search evidence (with MongoDB cache) ────────────────────────────

def _get_cached_search(query_hash: str) -> str | None:
    """Check MongoDB cache for existing search results."""
    doc = search_cache_col().find_one({"query_hash": query_hash})
    if doc:
        return doc["results"]
    return None


def _cache_search(query: str, query_hash: str, results: str) -> None:
    """Save search results to MongoDB cache."""
    now = datetime.now(timezone.utc)
    cache_doc = SearchCacheDoc(
        query_hash=query_hash,
        query=query,
        results=results,
        cached_at=now,
        expires_at=now + timedelta(hours=SEARCH_CACHE_TTL_HOURS),
    )
    search_cache_col().update_one(
        {"query_hash": query_hash},
        {"$set": cache_doc.dict()},
        upsert=True,
    )


def _rephrase_query(claim: str) -> list[str]:
    """Ask LLM to generate 2-3 alternative search query rephrasings targeting newsletters and news articles."""
    prompt = f"""You are an expert news research assistant. Given the factual claim below, generate exactly 3 alternative search queries designed to find recent news articles, newsletters, and fact-checks about this topic.
Make the queries varied (e.g. keyword-focused, headline-focused, and entity/date-focused).

Claim: "{claim}"

Return ONLY a JSON array of 3 query strings. Example: ["query 1", "query 2", "query 3"]"""
    try:
        res = llm.invoke(prompt)
        queries = _parse_json(res.content)
        if isinstance(queries, list) and len(queries) > 0:
            return [str(q) for q in queries[:3]]
    except Exception as e:
        print(f"      [WARN] Rephrase failed: {e}")
    return [claim]


def search_claim(claim: str) -> str:
    """Search a single claim across 2-3 LLM rephrasings. Uses cache if available."""
    query_hash = _sha256(claim)

    # Try cache first
    cached = _get_cached_search(query_hash)
    if cached:
        print(f"      -> cache hit")
        return cached

    # Rephrase claim into 2-3 queries
    queries = [claim]
    rephrased = _rephrase_query(claim)
    for q in rephrased:
        if q not in queries:
            queries.append(q)
    
    print(f"      -> Searching across {len(queries)} query angles (original + rephrasing)...")
    
    all_raw_results = []
    for q in queries[:3]:
        try:
            res = search_tool.invoke(q)
            if res and "No search results found" not in res:
                all_raw_results.append(f"=== SEARCH RESULTS FOR: \"{q}\" ===\n{res}")
        except Exception as e:
            print(f"      [WARN] Search error for query '{q}': {e}")

    results = "\n\n".join(all_raw_results) if all_raw_results else "No results found."

    # Cache for next time
    _cache_search(claim, query_hash, results)
    return results


def search_all_claims(claims: list[str]) -> list[EvidenceItem]:
    """Search all claims and return structured evidence items."""
    evidence = []
    for i, claim in enumerate(claims):
        print(f"   [SEARCH] Searching claim {i + 1}/{len(claims)} ...")
        raw = search_claim(claim)
        evidence.append(EvidenceItem(
            claim_index=i,
            query=claim,
            raw_results=raw,
        ))
        time.sleep(SEARCH_DELAY_SECONDS)
    return evidence


# ── Step 3: Verify claims ───────────────────────────────────────────────────

def verify_claims(claims: list[str], evidence: list[EvidenceItem]) -> list[VerdictItem]:
    """Ask the LLM to judge each claim against gathered evidence."""
    template = get_active_prompt("claim_verification")

    claims_text = "\n".join(f"{i+1}. {c}" for i, c in enumerate(claims))
    evidence_text = "\n\n".join(
        f"--- Evidence for Claim {e.claim_index + 1} ---\n{e.raw_results}"
        for e in evidence
    )

    prompt = template.format(claims_text=claims_text, evidence_text=evidence_text)
    response = llm.invoke(prompt)
    raw_verdicts = _parse_json(response.content)

    if not isinstance(raw_verdicts, list):
        raise ValueError(f"Expected list of dicts, got: {type(raw_verdicts)}")

    # Validate and normalize each verdict
    verdicts = []
    for v in raw_verdicts:
        verdict = VerdictItem(
            claim=v.get("claim", ""),
            verdict=v.get("verdict", "NOT_ENOUGH_INFO"),
            confidence=max(0.0, min(1.0, float(v.get("confidence", 0.5)))),
            justification=v.get("justification", "No justification provided."),
        )
        verdicts.append(verdict)

    return verdicts


# ── Step 4: Compute credibility score ────────────────────────────────────────

def compute_credibility_score(verdicts: list[VerdictItem]) -> float:
    """
    Aggregate per-claim verdicts into a 0-1 article credibility score.
      SUPPORTS  → +confidence
      REFUTES   → −confidence
      NEI       → 0
    Map from [-n, +n] → [0, 1].
    """
    if not verdicts:
        return 0.5

    score = 0.0
    for v in verdicts:
        if v.verdict == "SUPPORTS":
            score += v.confidence
        elif v.verdict == "REFUTES":
            score -= v.confidence

    n = len(verdicts)
    normalized = (score + n) / (2 * n)
    return round(max(0.0, min(1.0, normalized)), 3)


# ── Step 5: Generate overall LLM verdict ────────────────────────────────────

def generate_overall_verdict(article_text: str, verdicts: list[VerdictItem], credibility: float) -> str:
    """Ask the LLM to give a final overall verdict on the article's truthfulness."""
    verdicts_summary = "\n".join(
        f"- Claim: {v.claim}\n  Verdict: {v.verdict} (confidence: {v.confidence})\n  Reason: {v.justification}"
        for v in verdicts
    )

    prompt = f"""You are an expert investigative fact-checker. Based on our deep web analysis and scraped source verification of the article below, provide a comprehensive structured verdict summary.

ARTICLE:
{article_text[:2000]}

INDIVIDUAL CLAIM ANALYSIS:
{verdicts_summary}

CREDIBILITY SCORE: {credibility} (0 = completely false, 1 = completely true)

Provide a well-structured Executive Verdict & Summary of Findings formatted exactly as follows (use plain readable text with clear spacing):

OVERALL VERDICT: [State explicitly: TRUE, MOSTLY TRUE, MIXED, MOSTLY FALSE, or FALSE]

SUMMARY OF FINDINGS:
Write a 3-4 sentence comprehensive executive summary detailing what our deep web search and link scraping uncovered. Mention which core claims held up against actual live source data and which were contradicted or fabricated.

KEY EVIDENCE BREAKDOWN:
• Synthesize the main verified facts vs. false statements found across sources.
• Highlight any unverified assertions that require caution.

Write in a crisp, objective, journalistic tone."""

    try:
        response = llm.invoke(prompt)
        return response.content.strip()
    except Exception as e:
        print(f"      [WARN] Overall verdict generation failed: {e}")
        return f"Credibility score: {round(credibility * 100)}%. Based on {len(verdicts)} analyzed claims."


# ── Step 6: Save to MongoDB ─────────────────────────────────────────────────

def save_result(result: FactCheckResult) -> str:
    """Persist the full fact-check result to MongoDB. Returns inserted _id."""
    doc = result.dict()
    inserted = fact_checks_col().insert_one(doc)
    return str(inserted.inserted_id)


# ── Full pipeline ────────────────────────────────────────────────────────────

def fact_check(article_text: str, max_claims: int = 5) -> dict:
    """
    Run the complete fact-checking pipeline on an article.
    Returns a dict with claims, verdicts, credibility_score, overall_verdict, and MongoDB _id.
    """
    start = time.time()

    print("=" * 60)
    print("       AGENTIC FACT-CHECKER")
    print("=" * 60)

    # 1 — Extract claims
    print("\n>> Step 1: Extracting claims ...")
    claims = extract_claims(article_text, max_claims=max_claims)

    # 2 — Search evidence
    print("\n>> Step 2: Searching for evidence ...")
    evidence = search_all_claims(claims)

    # 3 — Verify claims
    print("\n>> Step 3: Verifying claims ...")
    verdicts = verify_claims(claims, evidence)

    # 4 — Score
    credibility = compute_credibility_score(verdicts)

    # 5 — Overall LLM verdict
    print("\n>> Step 4: Generating overall verdict ...")
    overall_verdict = generate_overall_verdict(article_text, verdicts, credibility)

    duration = round(time.time() - start, 2)

    # 6 — Persist
    result = FactCheckResult(
        article_text=article_text.strip(),
        article_hash=_sha256(article_text),
        claims=claims,
        evidence=evidence,
        verdicts=verdicts,
        credibility_score=credibility,
        overall_verdict=overall_verdict,
        model_used=GROQ_MODEL,
        prompts_used={
            "extraction": "claim_extraction_v1",
            "verification": "claim_verification_v1",
        },
        duration_seconds=duration,
    )
    doc_id = save_result(result)

    # ── Pretty-print ─────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("       RESULTS")
    print("=" * 60)

    for v in verdicts:
        emoji = {"SUPPORTS": "[+]", "REFUTES": "[-]", "NOT_ENOUGH_INFO": "[?]"}.get(
            v.verdict, "[?]"
        )
        print(f"\n{emoji} [{v.verdict}]  confidence: {v.confidence:.2f}")
        print(f"   Claim: {v.claim}")
        print(f"   Why:   {v.justification}")

    print(f"\n>> Overall Verdict: {overall_verdict[:200]}...")
    print(f"\n>> Overall Credibility Score: {credibility}")
    print(f">> Pipeline took {duration}s")
    print(f">> Saved to MongoDB with _id: {doc_id}")
    print("=" * 60)

    return {
        "_id": doc_id,
        "claims": claims,
        "verdicts": [v.dict() for v in verdicts],
        "credibility_score": credibility,
        "overall_verdict": overall_verdict,
        "duration_seconds": duration,
    }

