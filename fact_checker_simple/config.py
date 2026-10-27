"""
config.py — Central configuration loaded from .env
"""

import builtins
import logging
import os
import sys
import warnings
from dotenv import load_dotenv

load_dotenv()

# Model output often contains characters like U+2011 (non-breaking hyphen) that a
# Windows console (cp1252) can't encode; a print() of them would crash the
# pipeline mid-request. Every entry point imports this module, so fix it here.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# On Vercel, stdout/stderr can be closed while a streamed response is still
# running. Anything that then writes to them raises "I/O operation on closed
# file" (ValueError), and the pipeline reports that as a failed fact-check.
# Diagnostics must never fail a request, so all three writers drop the output:
#   - print(): progress lines from worker threads (sources, debate agents)
#   - logging: httpx logs every Groq call; Handler.handleError only swallows
#     OSError, so its own report to a closed stderr escapes into the LLM call.
#     raiseExceptions = False is the documented production setting.
#   - warnings: LangChain warns when a model client is first created, and
#     showwarning likewise only swallows OSError.
_builtin_print = builtins.print
_builtin_showwarning = warnings.showwarning


def _safe_print(*args, **kwargs):
    try:
        _builtin_print(*args, **kwargs)
    except (ValueError, OSError):
        pass


def _safe_showwarning(*args, **kwargs):
    try:
        _builtin_showwarning(*args, **kwargs)
    except (ValueError, OSError):
        pass


builtins.print = _safe_print
warnings.showwarning = _safe_showwarning
logging.raiseExceptions = False

# ── Groq ─────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
# llama-3.3-70b-versatile (the paper's backbone) has been retired on Groq.
# qwen/qwen3.8-27b answers directly (no hidden reasoning tokens), which keeps
# MADAM-RAG's 128-token agent budget meaningful.
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
# Reasoning effort for gpt-oss models; ignored for others (see llm.py).
# "low" keeps hidden reasoning from eating the short debate output budgets.
GROQ_REASONING_EFFORT = os.getenv("GROQ_REASONING_EFFORT", "low")
GROQ_TEMPERATURE = 0.1
# Reasoning models (gpt-oss) spend hidden "thinking" tokens out of this budget,
# so it needs headroom beyond the visible JSON / summary.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "4096"))

# ── MongoDB ──────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "fact_checker")

# ── Search ───────────────────────────────────────────────────────────────────
SEARCH_NUM_RESULTS = int(os.getenv("SEARCH_NUM_RESULTS", "3"))
SEARCH_CACHE_TTL_HOURS = int(os.getenv("SEARCH_CACHE_TTL_HOURS", "24"))
# Questions are usually about current events ("this week", "latest"), so their
# query plans and search results go stale faster than fact-check evidence.
ANSWER_CACHE_TTL_HOURS = int(os.getenv("ANSWER_CACHE_TTL_HOURS", "6"))
SEARCH_DELAY_SECONDS = float(os.getenv("SEARCH_DELAY_SECONDS", "0.5"))
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
# Optional backup SerpAPI key(s), used automatically when the primary is
# exhausted (HTTP 401 "run out of searches"). Comma-separate for more than one.
SERPAPI_API_KEYS_BACKUP = [
    k.strip() for k in os.getenv("SERPAPI_API_KEY_2", "").split(",") if k.strip()
]
# Full ordered list of usable SerpAPI keys (primary first, then backups).
SERPAPI_API_KEYS = [k for k in ([SERPAPI_API_KEY] + SERPAPI_API_KEYS_BACKUP) if k]
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# ── MADAM-RAG (multi-agent debate verification) ──────────────────────────────
# Model for the RAMDocs replication (eval_ramdocs.py); defaults to
# GROQ_MODEL. A paper-style debate is ~13 requests per RAMDocs question.
MADAM_MODEL = os.getenv("MADAM_MODEL", "") or GROQ_MODEL
# Fact-checking debates run on their own model so they can't use up the main
# pipeline's daily quota. gpt-oss-20b is the smallest model that judged all 8
# hand-labelled claim/source cases correctly (numbers, dates, same-name people);
# allam-2-7b, the smallest chat model on Groq, got 3 of 8 and mostly agreed
# with whatever it was shown. 1,000 requests/day, ~25-40 debated articles.
FACTCHECK_DEBATE_MODEL = os.getenv("FACTCHECK_DEBATE_MODEL", "openai/gpt-oss-20b")
# "grouped" (default): sources form Supports/Refutes groups that argue it out.
# "paper": every agent re-answers every round, as in the paper's code.
FACTCHECK_DEBATE_STRATEGY = os.getenv("FACTCHECK_DEBATE_STRATEGY", "grouped")
# Sources (= agents) debated per claim, and how many agents call the LLM at once.
MADAM_MAX_AGENTS = int(os.getenv("MADAM_MAX_AGENTS", "4"))
MADAM_CONCURRENCY = int(os.getenv("MADAM_CONCURRENCY", "3"))

# ── Deployment ───────────────────────────────────────────────────────────────
# Port the API binds to. Hugging Face Spaces uses 7860; Render/Railway/Fly
# inject $PORT; locally it falls back to 8000.
PORT = int(os.getenv("PORT", "8000"))

# Comma-separated list of browser origins allowed to call the API, e.g.
#   CORS_ORIGINS=https://my-app.vercel.app,https://factcheck.example.com
# ALLOWED_ORIGINS is accepted as an older name for the same setting.
# Localhost and LAN dev servers are always allowed (see api.py).
CORS_ORIGINS = [
    o.strip().rstrip("/")
    for o in (os.getenv("CORS_ORIGINS") or os.getenv("ALLOWED_ORIGINS", "")).split(",")
    if o.strip()
]

# Regex for origins allowed in addition to CORS_ORIGINS. Defaults to matching
# Vercel preview deployments (every PR/branch gets its own *.vercel.app URL).
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https://.*\.vercel\.app",
)

# Seed the default prompt templates into MongoDB on startup. Without prompts in
# the DB the pipeline raises on every request, so a fresh deploy needs this.
AUTO_SEED_PROMPTS = os.getenv("AUTO_SEED_PROMPTS", "true").lower() != "false"

# ── Calibrated abstention ─────────────────────────────────────────────────────
# When the evidence-sufficiency judge scores below this threshold, the verdict is
# overridden to NOT_ENOUGH_INFO instead of committing to SUPPORTS/REFUTES. 0.0
# disables abstention (baseline behaviour). Tuned on the FEVER dev sample.
ABSTENTION_THRESHOLD = float(os.getenv("ABSTENTION_THRESHOLD", "0.0"))
