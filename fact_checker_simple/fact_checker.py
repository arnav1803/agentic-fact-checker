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
        # Search-engine / API hosts that appear inside raw results but are not
        # real sources (serpapi.com links even 401 without an API key).
        skip_hosts = ['serpapi.com', 'google.com/search', 'duckduckgo.com',
                      'bing.com', 'tavily.com', 'googleapis.com']
        # Deduplicate while preserving order
        seen = set()
        unique_urls = []
        for u in urls:
            # Strip trailing punctuation
            u = u.rstrip('.,:;')
            if (u not in seen
                    and not any(ext in u for ext in ['.pdf', '.jpg', '.png', '.gif', '.mp4'])
                    and not any(host in u for host in skip_hosts)):
                seen.add(u)
                unique_urls.append(u)
        
        scraped_sections = []
        for url in unique_urls[:3]:  # Open top 3 unique links
            print(f"      -> OPENING LINK: {url[:80]}")
            content = _scrape_url(url)
            if len(content) > 150:
                # NOTE: ASCII-only prints — non-ASCII (e.g. check marks) crashes the
                # Windows console codec and the UnicodeEncodeError used to silently
                # discard the entire search result upstream.
                print(f"         [OK] Scraped {len(content)} chars of page content")
                scraped_sections.append(
                    f"--- SCRAPED SOURCE PAGE: {url} ---\n"
                    f"Below is the actual text content read from this web page:\n"
                    f"{content}"
                )
            else:
                print(f"         [SKIP] Page returned insufficient content, skipping")
        
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


def _today_str() -> str:
    """Human-readable current date, injected into every prompt so the LLM
    doesn't fall back on its (stale) training-data sense of 'now'."""
    return datetime.now(timezone.utc).strftime("%B %d, %Y")


# ── Token budgeting & rate-limit handling ────────────────────────────────────
# Groq's on_demand tier allows 12,000 tokens/minute for this model. Scraped
# evidence can easily blow past that, so prompts are kept under a hard budget
# and LLM calls retry with backoff when the API rate-limits anyway.

MAX_PROMPT_TOKENS = 8000          # leave headroom under the 12k TPM limit
EVIDENCE_CHAR_BUDGET = 24000      # total evidence chars across all claims (~6k tokens)


def _estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token for English)."""
    return len(text) // 4


def _trim_evidence(raw: str, limit: int) -> str:
    """Trim one claim's evidence to a char limit, keeping the most useful parts:
    the search snippets at the top plus as much scraped page text as fits."""
    if len(raw) <= limit:
        return raw
    marker = "========== DEEP WEB VERIFICATION"
    idx = raw.find(marker)
    if idx > 0:
        snippets = raw[:idx].strip()
        scraped = raw[idx:]
        # Give snippets up to 40% of the budget, scraped pages the rest
        snippet_part = snippets[: int(limit * 0.4)]
        scraped_part = scraped[: limit - len(snippet_part)]
        trimmed = snippet_part + "\n\n" + scraped_part
    else:
        trimmed = raw[:limit]
    return trimmed + "\n[... evidence truncated to fit model limits ...]"


def _is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc)
    return "rate_limit_exceeded" in msg or "413" in msg or "429" in msg or "Request too large" in msg


def _suggested_wait_seconds(exc: Exception, default: float) -> float:
    """Groq 429 messages include 'Please try again in 7.66s' — honor it."""
    m = re.search(r"try again in ([\d.]+)s", str(exc))
    if m:
        return min(float(m.group(1)) + 1.0, 90.0)
    return default


def _llm_invoke(prompt: str, retries: int = 2):
    """llm.invoke with backoff on Groq rate-limit / too-large errors."""
    for attempt in range(retries + 1):
        try:
            return llm.invoke(prompt)
        except Exception as e:
            if attempt < retries and _is_rate_limit_error(e):
                wait = _suggested_wait_seconds(e, default=20.0 * (attempt + 1))
                print(f"      [WARN] Groq rate limit hit, retrying in {wait:.0f}s ...")
                time.sleep(wait)
                continue
            raise


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
    prompt = template.format(
        article_text=article_text.strip(),
        max_claims=max_claims,
        current_date=_today_str(),
    )

    response = _llm_invoke(prompt)
    claims = _parse_json(response.content)

    if not isinstance(claims, list) or not all(isinstance(c, str) for c in claims):
        raise ValueError(f"Expected list[str], got: {type(claims)}")

    print(f"\n[OK] Extracted {len(claims)} claims:")
    for i, c in enumerate(claims, 1):
        print(f"   {i}. {c}")
    return claims


# ── Step 2: Search evidence (with MongoDB cache) ────────────────────────────

def _get_cached_search(query_hash: str) -> str | None:
    """Check MongoDB cache for existing, non-expired, non-empty search results."""
    doc = search_cache_col().find_one({"query_hash": query_hash})
    if not doc:
        return None
    # Respect expiry even if Mongo's TTL monitor hasn't swept the doc yet
    expires = doc.get("expires_at")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return None
    results = doc.get("results", "")
    # Never serve a cached failure — retry the live search instead
    if not results or "No results found" in results[:40]:
        return None
    return results


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
    prompt = f"""You are an expert news research assistant. Today's date is {_today_str()}.
Given the factual claim below, generate exactly 3 alternative search queries designed to find recent news articles, newsletters, and fact-checks about this topic.
Make the queries varied (e.g. keyword-focused, headline-focused, and entity/date-focused).
Remember the current date when phrasing time-sensitive queries — events up to {_today_str()} may already have happened even if they are after your training cutoff.

Claim: "{claim}"

Return ONLY a JSON array of 3 query strings. Example: ["query 1", "query 2", "query 3"]"""
    try:
        res = _llm_invoke(prompt, retries=1)
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

    if not all_raw_results:
        # Do NOT cache failures — a transient provider error would otherwise
        # poison every retry of this claim for SEARCH_CACHE_TTL_HOURS.
        return "No results found."

    results = "\n\n".join(all_raw_results)
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

    # Fit the evidence into a token budget: each claim gets an equal share,
    # and the whole prompt is shrunk further if it still estimates too large.
    per_claim_budget = max(2500, EVIDENCE_CHAR_BUDGET // max(1, len(evidence)))

    def build_prompt(budget: int) -> str:
        evidence_text = "\n\n".join(
            f"--- Evidence for Claim {e.claim_index + 1} ---\n"
            f"{_trim_evidence(e.raw_results, budget)}"
            for e in evidence
        )
        return template.format(
            claims_text=claims_text,
            evidence_text=evidence_text,
            current_date=_today_str(),
        )

    prompt = build_prompt(per_claim_budget)
    while _estimate_tokens(prompt) > MAX_PROMPT_TOKENS and per_claim_budget > 1200:
        per_claim_budget = int(per_claim_budget * 0.6)
        prompt = build_prompt(per_claim_budget)

    # If Groq still rejects the request as too large, shrink harder and retry
    response = None
    for attempt in range(3):
        try:
            response = _llm_invoke(prompt)
            break
        except Exception as e:
            if attempt < 2 and ("Request too large" in str(e) or "413" in str(e)):
                per_claim_budget = max(800, per_claim_budget // 2)
                print(f"      [WARN] Prompt too large for Groq, shrinking evidence to "
                      f"{per_claim_budget} chars/claim and retrying ...")
                prompt = build_prompt(per_claim_budget)
                continue
            raise

    raw_verdicts = _parse_json(response.content)

    if not isinstance(raw_verdicts, list):
        raise ValueError(f"Expected list of dicts, got: {type(raw_verdicts)}")

    # Map loose LLM verdict strings onto the canonical three labels
    verdict_aliases = {
        "SUPPORTS": "SUPPORTS", "SUPPORTED": "SUPPORTS", "TRUE": "SUPPORTS",
        "REFUTES": "REFUTES", "REFUTED": "REFUTES", "FALSE": "REFUTES",
        "NOT_ENOUGH_INFO": "NOT_ENOUGH_INFO", "NOT ENOUGH INFO": "NOT_ENOUGH_INFO",
        "UNVERIFIED": "NOT_ENOUGH_INFO", "UNKNOWN": "NOT_ENOUGH_INFO",
    }

    # Validate and normalize each verdict
    verdicts = []
    for v in raw_verdicts:
        raw_label = str(v.get("verdict", "NOT_ENOUGH_INFO")).strip().upper()
        verdict = VerdictItem(
            claim=v.get("claim", ""),
            verdict=verdict_aliases.get(raw_label, "NOT_ENOUGH_INFO"),
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

def compute_overall_label(verdicts: list[VerdictItem], credibility: float) -> str:
    """
    Derive the overall verdict label DETERMINISTICALLY from the per-claim
    verdicts, so it can never contradict the credibility score or claim cards.

    Key rule: "we found no evidence" is UNVERIFIED, not FALSE. FALSE requires
    actual refuting evidence.
    """
    if not verdicts:
        return "UNVERIFIED"

    supports = sum(1 for v in verdicts if v.verdict == "SUPPORTS")
    refutes = sum(1 for v in verdicts if v.verdict == "REFUTES")

    # Nothing was actually decided either way -> we simply don't know
    if supports == 0 and refutes == 0:
        return "UNVERIFIED"

    if credibility >= 0.8:
        return "TRUE"
    if credibility >= 0.6:
        return "MOSTLY TRUE"
    if credibility > 0.4:
        return "MIXED"
    if credibility > 0.2:
        return "MOSTLY FALSE"
    return "FALSE"


def generate_overall_verdict(article_text: str, verdicts: list[VerdictItem], credibility: float) -> str:
    """Generate the structured verdict summary. The OVERALL VERDICT label is
    computed deterministically; the LLM only writes the narrative around it."""
    label = compute_overall_label(verdicts, credibility)

    verdicts_summary = "\n".join(
        f"- Claim: {v.claim}\n  Verdict: {v.verdict} (confidence: {v.confidence})\n  Reason: {v.justification[:500]}"
        for v in verdicts
    )

    unverified_note = (
        "\nIMPORTANT: The verdict is UNVERIFIED because our web search could not find "
        "evidence that decides these claims either way. Do NOT describe the claims as "
        "false or fabricated — say clearly that they could not be verified at this time "
        "and why (too recent, too obscure, or sources unavailable)."
        if label == "UNVERIFIED"
        else ""
    )

    prompt = f"""You are an expert investigative fact-checker. Today's date is {_today_str()}.
Your knowledge has a training cutoff, so events after that cutoff may already have happened — base your summary ONLY on the claim analysis below (which comes from live web search and scraped pages), never on your own memory of what has or hasn't occurred.

ARTICLE:
{article_text[:2000]}

INDIVIDUAL CLAIM ANALYSIS:
{verdicts_summary}

CREDIBILITY SCORE: {credibility} (0 = completely false, 1 = completely true)

The overall verdict has already been determined by our scoring system: {label}
{unverified_note}
Write the two narrative sections below, consistent with that verdict (use plain readable text with clear spacing):

SUMMARY OF FINDINGS:
Write a 3-4 sentence comprehensive executive summary detailing what our deep web search and link scraping uncovered. Mention which core claims held up against actual live source data, which were contradicted, and which could not be verified.

KEY EVIDENCE BREAKDOWN:
• Synthesize the main verified facts vs. refuted statements found across sources.
• Highlight any unverified assertions that require caution.

Write in a crisp, objective, journalistic tone. Do NOT repeat the OVERALL VERDICT line — output only the two sections above."""

    try:
        response = _llm_invoke(prompt)
        narrative = response.content.strip()
        # Strip any OVERALL VERDICT line the LLM added anyway, then prepend ours
        narrative = re.sub(
            r"^\s*OVERALL VERDICT\s*:.*?(?=SUMMARY OF FINDINGS)", "",
            narrative, flags=re.IGNORECASE | re.DOTALL,
        ).strip()
        return f"OVERALL VERDICT: {label}\n\n{narrative}"
    except Exception as e:
        print(f"      [WARN] Overall verdict generation failed: {e}")
        return (
            f"OVERALL VERDICT: {label}\n\n"
            f"SUMMARY OF FINDINGS:\nCredibility score: {round(credibility * 100)}%. "
            f"Based on {len(verdicts)} analyzed claims."
        )


# ── Step 6: Save to MongoDB ─────────────────────────────────────────────────

def save_result(result: FactCheckResult) -> str:
    """Persist the full fact-check result to MongoDB. Returns inserted _id."""
    doc = result.dict()
    inserted = fact_checks_col().insert_one(doc)
    return str(inserted.inserted_id)


# ── Article fetching (analyze by URL) ───────────────────────────────────────

def fetch_article_text(url: str) -> str:
    """
    Download a news article URL and extract its readable text.
    Prefers <article>/<p> content; raises ValueError if extraction fails.
    """
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise ValueError("URL must start with http:// or https://")

    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read()
    except Exception as e:
        raise ValueError(f"Could not fetch the URL: {e}")

    try:
        html = raw.decode('utf-8')
    except UnicodeDecodeError:
        html = raw.decode('latin-1', errors='ignore')

    # Drop non-content sections
    for tag in ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'noscript']:
        html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', html, flags=re.DOTALL | re.IGNORECASE)

    # Prefer the <article> element when present
    article_match = re.search(r'<article[^>]*>(.*?)</article>', html, re.DOTALL | re.IGNORECASE)
    scope = article_match.group(1) if article_match else html

    # Collect substantial paragraphs
    paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', scope, re.DOTALL | re.IGNORECASE)
    cleaned = []
    for p in paragraphs:
        text = re.sub(r'<[^>]+>', ' ', p)
        text = ' '.join(text.split())
        if len(text) >= 60:  # skip boilerplate/captions
            cleaned.append(text)

    article_text = "\n\n".join(cleaned)

    # Fallback: strip everything if no usable paragraphs were found
    if len(article_text) < 200:
        text = re.sub(r'<[^>]+>', ' ', scope)
        article_text = ' '.join(text.split())

    article_text = article_text[:12000].strip()
    if len(article_text) < 100:
        raise ValueError("Could not extract readable article text from this URL")
    return article_text


# ── Full pipeline ────────────────────────────────────────────────────────────

def fact_check_stream(article_text: str, max_claims: int = 5):
    """
    Run the fact-checking pipeline as a generator, yielding progress events:
      {"event": "step",   "step": "extract" | "verify" | "summarize"}
      {"event": "claims", "claims": [...]}
      {"event": "step",   "step": "search", "current": i, "total": n, "claim": "..."}
      {"event": "done",   "result": {...}}          <- always the final event
    """
    start = time.time()

    print("=" * 60)
    print("       AGENTIC FACT-CHECKER")
    print("=" * 60)

    # 1 — Extract claims
    print("\n>> Step 1: Extracting claims ...")
    yield {"event": "step", "step": "extract"}
    claims = extract_claims(article_text, max_claims=max_claims)
    yield {"event": "claims", "claims": claims}

    # 2 — Search evidence (streamed per claim)
    print("\n>> Step 2: Searching for evidence ...")
    evidence = []
    for i, claim in enumerate(claims):
        yield {
            "event": "step", "step": "search",
            "current": i + 1, "total": len(claims), "claim": claim,
        }
        print(f"   [SEARCH] Searching claim {i + 1}/{len(claims)} ...")
        raw = search_claim(claim)
        evidence.append(EvidenceItem(claim_index=i, query=claim, raw_results=raw))
        time.sleep(SEARCH_DELAY_SECONDS)

    # 3 — Verify claims
    print("\n>> Step 3: Verifying claims ...")
    yield {"event": "step", "step": "verify"}
    verdicts = verify_claims(claims, evidence)

    # 4 — Score
    credibility = compute_credibility_score(verdicts)

    # 5 — Overall LLM verdict
    print("\n>> Step 4: Generating overall verdict ...")
    yield {"event": "step", "step": "summarize"}
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
            "extraction": "claim_extraction_v3",
            "verification": "claim_verification_v3",
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

    yield {
        "event": "done",
        "result": {
            "_id": doc_id,
            "claims": claims,
            "verdicts": [v.dict() for v in verdicts],
            "credibility_score": credibility,
            "overall_verdict": overall_verdict,
            "duration_seconds": duration,
        },
    }


def fact_check(article_text: str, max_claims: int = 5) -> dict:
    """
    Run the complete fact-checking pipeline on an article (blocking wrapper
    around fact_check_stream). Returns a dict with claims, verdicts,
    credibility_score, overall_verdict, and MongoDB _id.
    """
    result = None
    for event in fact_check_stream(article_text, max_claims=max_claims):
        if event.get("event") == "done":
            result = event["result"]
    return result

