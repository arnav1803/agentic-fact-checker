"""
api.py - FastAPI backend that exposes the fact-checker pipeline as REST endpoints.

Endpoints:
  POST   /api/fact-check       - Run fact-check on an article (dedupes recent identical articles)
  GET    /api/history          - List recent fact-checks (pagination + search + per-user filter)
  GET    /api/fact-check/{id}  - Get a specific fact-check by ID
  DELETE /api/fact-check/{id}  - Delete a fact-check
  GET    /api/health           - Health check (pings MongoDB)

Per-user data (demo-grade):
  The frontend sends the signed-in user's email in the `X-User-Email` header.
  It is stored as `user_id` on each fact-check and used to filter history.
  NOTE: this is NOT authentication — swap for verified Google ID tokens / JWTs
  before any real deployment (see BACKEND_IDEAS.md).

Run:
  python api.py
"""

import json
import queue
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from bson import ObjectId

from config import (
    AUTO_SEED_PROMPTS,
    CORS_ORIGIN_REGEX,
    CORS_ORIGINS,
    FACTCHECK_DEBATE_MODEL,
    GROQ_MODEL,
    PORT,
)
from db import fact_checks_col, get_client
from fact_checker import analyze, analyze_stream, fetch_article_text, input_hash
from madam_rag import DEFAULT_ROUNDS, MAX_ROUNDS

# ── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    Seed the default prompt templates before serving traffic. A fresh deploy has
    an empty `prompts` collection, and every pipeline run raises without one.
    The seed upserts by name+version, so running it on each boot is a no-op once
    the prompts are there. Set AUTO_SEED_PROMPTS=false to manage them by hand.
    """
    if AUTO_SEED_PROMPTS:
        try:
            from seed_prompts import seed
            seed()
        except Exception as e:
            # Never block startup on this - /api/health still reports Mongo state.
            print(f"[WARN] Prompt seeding failed: {e}")
    yield


app = FastAPI(
    title="Agentic Fact-Checker API",
    description="AI-powered news article verification using Groq LLM + web search",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Local dev servers are always allowed, including from other devices on the
# same LAN (e.g. a phone hitting http://192.168.x.x:8080). Deployed frontends
# are added via the CORS_ORIGINS env var (comma-separated) and
# CORS_ORIGIN_REGEX (defaults to matching Vercel preview URLs). See config.py.

LOCAL_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (3000, 5173, 5174, 8080, 8081)
]
LAN_ORIGIN_REGEX = r"^http://(localhost|127\.0\.0\.1|(\d{1,3}\.){3}\d{1,3})(:\d+)?$"

ALLOWED_ORIGINS = LOCAL_ORIGINS + CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    # Deployed frontends (e.g. https://my-app.vercel.app) are allowed via ALLOWED_ORIGINS.
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex="|".join(
        f"(?:{r})" for r in (LAN_ORIGIN_REGEX, CORS_ORIGIN_REGEX) if r
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# How long an identical article's result is reused instead of re-running the
# (slow, paid) pipeline. Clients can bypass with force=true.
DEDUP_WINDOW_HOURS = 1

# ── Rate limiting (in-memory, per client IP) ─────────────────────────────────
# The pipeline triggers paid LLM + search API calls, so cap how often a single
# client can start it. Dedup cache hits do NOT count against the limit.

RATE_LIMIT_RUNS = 6           # max pipeline runs ...
RATE_LIMIT_WINDOW_SECONDS = 300   # ... per 5 minutes per IP

_rate_lock = threading.Lock()
_rate_buckets: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(request: Request) -> None:
    """Raise 429 if this client started too many pipeline runs recently."""
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets[ip]
        while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_RUNS:
            retry_in = int(RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit reached ({RATE_LIMIT_RUNS} analyses per "
                       f"{RATE_LIMIT_WINDOW_SECONDS // 60} minutes). "
                       f"Try again in ~{retry_in}s.",
            )
        bucket.append(now)


# ── Request / Response Models ────────────────────────────────────────────────

class FactCheckRequest(BaseModel):
    article_text: str = ""
    url: str = Field(
        default="",
        description="Alternative to article_text: a news article URL to fetch and analyze",
    )
    max_claims: int = Field(default=5, ge=1, le=10)
    force: bool = Field(
        default=False,
        description="Re-run the pipeline even if this exact article was checked recently",
    )
    verification: Literal["standard", "madam"] = Field(
        default="standard",
        description="'standard': one LLM call judges all claims. 'madam': MADAM-RAG "
                    "multi-agent debate, one agent per web source (slower, more tokens).",
    )
    debate_rounds: int = Field(default=DEFAULT_ROUNDS, ge=1, le=MAX_ROUNDS)


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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _iso(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


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
        "created_at": _iso(doc.get("created_at", datetime.now(timezone.utc))),
        "verification_method": doc.get("verification_method", "standard"),
        "debates": doc.get("debates", []),
        "mode": doc.get("mode", "fact_check"),
        "answer": doc.get("answer", ""),
        "sources": doc.get("sources", []),
    }


def _parse_oid(fact_check_id: str) -> ObjectId:
    try:
        return ObjectId(fact_check_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID format")


def _resolve_article_text(req: FactCheckRequest) -> str:
    """Return the article text to analyze — fetched from the URL if given."""
    if req.article_text.strip():
        return req.article_text
    if req.url.strip():
        try:
            return fetch_article_text(req.url.strip())
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    raise HTTPException(status_code=400, detail="Provide article_text or url")


def _find_recent_duplicate(article_text: str, verification: str) -> Optional[dict]:
    """Identical article checked the same way within the dedup window? Return its doc."""
    article_hash = input_hash(article_text)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=DEDUP_WINDOW_HOURS)
    method = (
        {"verification_method": "madam"}
        if verification == "madam"
        # Results saved before debates existed have no verification_method field
        else {"verification_method": {"$in": ["standard", None]}}
    )
    return fact_checks_col().find_one(
        {"article_hash": article_hash, "created_at": {"$gte": cutoff}, **method},
        sort=[("created_at", -1)],
    )


def _tag_owner(doc_id: str, user_email: Optional[str]) -> None:
    """Demo-grade ownership tag (see module docstring)."""
    if user_email:
        fact_checks_col().update_one(
            {"_id": ObjectId(doc_id)}, {"$set": {"user_id": user_email}}
        )


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/api/fact-check")
def run_fact_check(
    req: FactCheckRequest,
    request: Request,
    x_user_email: Optional[str] = Header(default=None),
):
    """Run the full fact-checking pipeline on an article (blocking)."""
    article_text = _resolve_article_text(req)

    # ── Dedup: identical article checked very recently? Return the saved result ──
    if not req.force:
        recent = _find_recent_duplicate(article_text, req.verification)
        if recent:
            return _doc_to_response(recent)

    _check_rate_limit(request)

    try:
        result = analyze(
            article_text,
            max_claims=req.max_claims,
            verification=req.verification,
            debate_rounds=req.debate_rounds,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")

    _tag_owner(result["_id"], x_user_email)

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
        "overall_verdict": result.get("overall_verdict", ""),
        "duration_seconds": result["duration_seconds"],
        "model": GROQ_MODEL,
        "article_text": article_text.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "verification_method": result.get("verification_method", "standard"),
        "debates": result.get("debates", []),
        "mode": result.get("mode", "fact_check"),
        "answer": result.get("answer", ""),
        "sources": result.get("sources", []),
    }


HEARTBEAT_SECONDS = 15


def _with_heartbeat(lines, every: float = HEARTBEAT_SECONDS):
    """
    Yield from an NDJSON line generator, adding {"event":"ping"} whenever it has
    been quiet for `every` seconds. A slow step (a Groq rate-limit backoff, a
    slow site) otherwise looks like a dead connection to the client's idle
    watchdog. If the client disconnects, the pipeline stops at its next event.
    """
    q: queue.Queue = queue.Queue()
    stop = threading.Event()
    done = object()

    def produce():
        try:
            for line in lines:
                if stop.is_set():
                    break
                q.put(line)
        except Exception as e:  # the wrapped generators report their own errors; belt and braces
            q.put(json.dumps({"event": "error", "detail": f"Pipeline error: {e}"}) + "\n")
        finally:
            lines.close()
            q.put(done)

    threading.Thread(target=produce, daemon=True).start()
    try:
        while True:
            try:
                item = q.get(timeout=every)
            except queue.Empty:
                yield json.dumps({"event": "ping"}) + "\n"
                continue
            if item is done:
                return
            yield item
    finally:
        stop.set()


@app.post("/api/fact-check/stream")
def run_fact_check_streaming(
    req: FactCheckRequest,
    request: Request,
    x_user_email: Optional[str] = Header(default=None),
):
    """
    Run the pipeline and stream REAL progress as NDJSON (one JSON object per line):
      {"event":"mode","mode":"fact_check"|"answer"}   (questions are answered, see analyze_stream)
      {"event":"step","step":"extract"}
      {"event":"claims","claims":[...]}
      {"event":"step","step":"search","current":1,"total":3,"claim":"..."}
      {"event":"step","step":"verify"} / {"event":"step","step":"summarize"}
      {"event":"done","result":{...full fact-check response...}}
      {"event":"error","detail":"..."}   (on failure)
    With verification="madam", "sources" and "debate" events stream each
    claim's debate live (see fact_checker.fact_check_stream).
    """
    article_text = _resolve_article_text(req)

    # Dedup hits stream a single "done" event immediately
    if not req.force:
        recent = _find_recent_duplicate(article_text, req.verification)
        if recent:
            def cached_gen():
                yield json.dumps({"event": "done", "result": _doc_to_response(recent)}) + "\n"
            return StreamingResponse(cached_gen(), media_type="application/x-ndjson")

    _check_rate_limit(request)

    def event_gen():
        try:
            for event in analyze_stream(
                article_text,
                max_claims=req.max_claims,
                verification=req.verification,
                debate_rounds=req.debate_rounds,
            ):
                if event.get("event") == "done":
                    result = event["result"]
                    _tag_owner(result["_id"], x_user_email)
                    doc = fact_checks_col().find_one({"_id": ObjectId(result["_id"])})
                    payload = _doc_to_response(doc) if doc else result
                    yield json.dumps({"event": "done", "result": payload}) + "\n"
                else:
                    yield json.dumps(event) + "\n"
        except Exception as e:
            yield json.dumps({"event": "error", "detail": f"Pipeline error: {str(e)}"}) + "\n"

    return StreamingResponse(
        _with_heartbeat(event_gen()),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/history")
def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: Optional[str] = Query(default=None, description="Case-insensitive text filter"),
    x_user_email: Optional[str] = Header(default=None),
):
    """Return fact-checks, newest first. Filters by user when X-User-Email is sent."""
    query: dict = {}
    if x_user_email:
        query["user_id"] = x_user_email
    if q and q.strip():
        import re as _re
        query["article_text"] = {"$regex": _re.escape(q.strip()), "$options": "i"}

    cursor = (
        fact_checks_col()
        .find(query, {"_id": 1, "article_text": 1, "credibility_score": 1, "created_at": 1, "mode": 1})
        .sort("created_at", -1)
        .skip(offset)
        .limit(limit)
    )

    items = []
    for doc in cursor:
        article = doc.get("article_text", "")
        items.append({
            "_id": str(doc["_id"]),
            "article_text": article[:200] if article else "",
            "credibility_score": doc.get("credibility_score", 0.5),
            "created_at": _iso(doc.get("created_at", "")),
            "mode": doc.get("mode", "fact_check"),
        })
    return items


@app.get("/api/fact-check/{fact_check_id}")
def get_fact_check(fact_check_id: str):
    """Get a specific fact-check result by its MongoDB _id."""
    oid = _parse_oid(fact_check_id)

    doc = fact_checks_col().find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Fact-check not found")

    return _doc_to_response(doc)


@app.delete("/api/fact-check/{fact_check_id}")
def delete_fact_check(fact_check_id: str):
    """Delete a fact-check by its MongoDB _id."""
    oid = _parse_oid(fact_check_id)

    result = fact_checks_col().delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fact-check not found")

    return {"deleted": True, "_id": fact_check_id}


@app.get("/api/stats")
def get_stats(x_user_email: Optional[str] = Header(default=None)):
    """Aggregate stats: total checks, average score, verdict distribution."""
    # Answered questions have no credibility score, so only fact-checks count
    # (older docs predate the mode field and are all fact-checks).
    match: dict = {"mode": {"$ne": "answer"}}
    if x_user_email:
        match["user_id"] = x_user_email

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "avg_score": {"$avg": "$credibility_score"},
            }
        },
    ]
    agg = list(fact_checks_col().aggregate(pipeline))
    total = agg[0]["total"] if agg else 0
    avg_score = round(agg[0]["avg_score"], 3) if agg else 0.0

    verdict_pipeline = [
        {"$match": match},
        {"$unwind": "$verdicts"},
        {"$group": {"_id": "$verdicts.verdict", "count": {"$sum": 1}}},
    ]
    verdict_counts = {
        doc["_id"]: doc["count"]
        for doc in fact_checks_col().aggregate(verdict_pipeline)
    }

    return {
        "total_checks": total,
        "average_credibility": avg_score,
        "verdict_distribution": verdict_counts,
    }


@app.get("/", include_in_schema=False)
def root():
    """Send visitors of the bare API URL to the interactive docs."""
    return RedirectResponse(url="/docs")


@app.get("/api/health")
def health():
    """Health check: verifies the API is up AND MongoDB is reachable."""
    mongo_ok = True
    try:
        get_client().admin.command("ping")
    except Exception:
        mongo_ok = False

    return {
        "status": "ok" if mongo_ok else "degraded",
        "mongo": "up" if mongo_ok else "down",
        "model": GROQ_MODEL,
        "debate_model": FACTCHECK_DEBATE_MODEL,
    }


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"Starting Fact-Checker API on http://localhost:{PORT}")
    print(f"Docs at http://localhost:{PORT}/docs")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
