"""
api.py - FastAPI backend that exposes the fact-checker pipeline as REST endpoints.

Endpoints:
  POST /api/fact-check      - Run fact-check on an article
  GET  /api/history          - List recent fact-checks
  GET  /api/fact-check/{id}  - Get a specific fact-check by ID

Run:
  python api.py
"""

import sys
import json
import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from bson import ObjectId

from config import GROQ_MODEL
from db import fact_checks_col
from fact_checker import fact_check

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Agentic Fact-Checker API",
    description="AI-powered news article verification using Groq LLM + DuckDuckGo Search",
    version="1.0.0",
)

# Allow frontend to call the API (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # In production, restrict to your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request / Response Models ────────────────────────────────────────────────

class FactCheckRequest(BaseModel):
    article_text: str
    max_claims: int = Field(default=5, ge=1, le=10)


class VerdictResponse(BaseModel):
    claim: str
    verdict: str
    confidence: float
    justification: str


class FactCheckResponse(BaseModel):
    _id: str
    claims: list
    verdicts: list
    credibility_score: float
    overall_verdict: str = ""
    duration_seconds: float
    model: str = ""
    article_text: str = ""
    created_at: str = ""


class HistoryItemResponse(BaseModel):
    _id: str
    article_text: str
    credibility_score: float
    created_at: str


# ── Helper ───────────────────────────────────────────────────────────────────

def _doc_to_response(doc: dict) -> dict:
    """Convert a MongoDB fact_check document to API response format."""
    return {
        "_id": str(doc.get("_id", "")),
        "claims": doc.get("claims", []),
        "verdicts": doc.get("verdicts", []),
        "credibility_score": doc.get("credibility_score", 0.5),
        "overall_verdict": doc.get("overall_verdict", ""),
        "duration_seconds": doc.get("duration_seconds", 0),
        "model": doc.get("model_used", GROQ_MODEL),
        "article_text": doc.get("article_text", ""),
        "created_at": doc.get("created_at", datetime.now(timezone.utc)).isoformat()
            if isinstance(doc.get("created_at"), datetime)
            else str(doc.get("created_at", "")),
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/api/fact-check")
def run_fact_check(req: FactCheckRequest):
    """Run the full fact-checking pipeline on an article."""
    if not req.article_text.strip():
        raise HTTPException(status_code=400, detail="article_text cannot be empty")

    try:
        result = fact_check(req.article_text, max_claims=req.max_claims)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")

    # Fetch the saved document from MongoDB to get full data
    doc = fact_checks_col().find_one({"_id": ObjectId(result["_id"])})
    if doc:
        return _doc_to_response(doc)

    # Fallback: return the pipeline result directly
    return {
        "_id": result["_id"],
        "claims": result["claims"],
        "verdicts": result["verdicts"],
        "credibility_score": result["credibility_score"],
        "duration_seconds": result["duration_seconds"],
        "model": GROQ_MODEL,
        "article_text": req.article_text.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/history")
def get_history():
    """Return the last 20 fact-checks, newest first."""
    cursor = fact_checks_col().find(
        {},
        {
            "_id": 1,
            "article_text": 1,
            "credibility_score": 1,
            "created_at": 1,
        },
    ).sort("created_at", -1).limit(20)

    items = []
    for doc in cursor:
        article = doc.get("article_text", "")
        items.append({
            "_id": str(doc["_id"]),
            "article_text": article[:200] if article else "",
            "credibility_score": doc.get("credibility_score", 0.5),
            "created_at": doc.get("created_at", "").isoformat()
                if isinstance(doc.get("created_at"), datetime)
                else str(doc.get("created_at", "")),
        })
    return items


@app.get("/api/fact-check/{fact_check_id}")
def get_fact_check(fact_check_id: str):
    """Get a specific fact-check result by its MongoDB _id."""
    try:
        oid = ObjectId(fact_check_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    doc = fact_checks_col().find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Fact-check not found")

    return _doc_to_response(doc)


@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "model": GROQ_MODEL}


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("Starting Fact-Checker API on http://localhost:8000")
    print("Docs at http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
