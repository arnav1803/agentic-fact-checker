"""
db.py — MongoDB connection and collection accessors
"""

from pymongo import MongoClient, ASCENDING
from pymongo.collection import Collection
from datetime import datetime, timedelta, timezone

from config import MONGO_URI, MONGO_DB, SEARCH_CACHE_TTL_HOURS

# ── Singleton connection ─────────────────────────────────────────────────────
_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        import certifi
        import ssl
        try:
            _client = MongoClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
            _client.admin.command("ping")  # test connection
        except Exception:
            # Fallback: skip TLS verification (dev only)
            _client = MongoClient(MONGO_URI, tls=True, tlsAllowInvalidCertificates=True)
        _ensure_indexes()
    return _client


def get_db():
    return get_client()[MONGO_DB]


# ── Collection accessors ─────────────────────────────────────────────────────

def prompts_col() -> Collection:
    return get_db()["prompts"]


def fact_checks_col() -> Collection:
    return get_db()["fact_checks"]


def search_cache_col() -> Collection:
    return get_db()["search_cache"]


# ── Indexes ──────────────────────────────────────────────────────────────────

def _ensure_indexes():
    """Create indexes on first connection."""
    # Prompts: unique (name, version), fast lookup by active name
    prompts_col().create_index(
        [("name", ASCENDING), ("version", ASCENDING)],
        unique=True,
    )
    prompts_col().create_index([("name", ASCENDING), ("is_active", ASCENDING)])

    # Fact checks: lookup by article hash, sort by created_at
    fact_checks_col().create_index("article_hash")
    fact_checks_col().create_index("created_at")

    # Search cache: TTL auto-expiry + fast lookup by query hash
    search_cache_col().create_index("query_hash", unique=True)
    search_cache_col().create_index(
        "expires_at",
        expireAfterSeconds=0,   # MongoDB TTL: deletes when expires_at is reached
    )
