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
GROQ_MAX_TOKENS = 2048

# ── MongoDB ──────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "fact_checker")

# ── Search ───────────────────────────────────────────────────────────────────
SEARCH_NUM_RESULTS = int(os.getenv("SEARCH_NUM_RESULTS", "3"))
SEARCH_CACHE_TTL_HOURS = int(os.getenv("SEARCH_CACHE_TTL_HOURS", "24"))
SEARCH_DELAY_SECONDS = float(os.getenv("SEARCH_DELAY_SECONDS", "0.5"))
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
   # polite delay between searches
