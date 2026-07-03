"""
models.py — Pydantic schemas for validation & serialization
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

def utc_now():
    return datetime.now(timezone.utc)


# ── Prompt ───────────────────────────────────────────────────────────────────

class PromptDoc(BaseModel):
    """Schema for a prompt template stored in MongoDB."""
    name: str
    version: int = 1
    template: str
    description: str = ""
    variables: list[str] = []
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


# ── Evidence ─────────────────────────────────────────────────────────────────

class EvidenceItem(BaseModel):
    """Search evidence for a single claim."""
    claim_index: int
    query: str
    raw_results: str
    searched_at: datetime = Field(default_factory=utc_now)


# ── Verdict ──────────────────────────────────────────────────────────────────

class VerdictItem(BaseModel):
    """LLM verdict for a single claim."""
    claim: str
    verdict: str = "NOT_ENOUGH_INFO"       # SUPPORTS | REFUTES | NOT_ENOUGH_INFO
    confidence: float = 0.5
    justification: str = ""


# ── Fact Check Result ────────────────────────────────────────────────────────

class FactCheckResult(BaseModel):
    """Full fact-check run stored in MongoDB."""
    article_text: str
    article_hash: str
    claims: list[str] = []
    evidence: list[EvidenceItem] = []
    verdicts: list[VerdictItem] = []
    credibility_score: float = 0.5
    overall_verdict: str = ""          # LLM's final judgment on the article
    model_used: str = ""
    prompts_used: dict = {}
    duration_seconds: float = 0.0
    created_at: datetime = Field(default_factory=utc_now)


# ── Search Cache ─────────────────────────────────────────────────────────────

class SearchCacheDoc(BaseModel):
    """Cached search result."""
    query_hash: str
    query: str
    results: str
    cached_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime    # set by caller (now + TTL)
