"""
config.py — Central configuration loaded from .env
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Groq ─────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_TEMPERATURE = 0.1
# Reasoning models (gpt-oss) spend hidden "thinking" tokens out of this budget,
# so it needs headroom beyond the visible JSON / summary.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "4096"))
# Only sent to reasoning models. "low" keeps thinking short enough that long
# verifications don't run out of tokens mid-JSON.
GROQ_REASONING_EFFORT = os.getenv("GROQ_REASONING_EFFORT", "low")

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
