"""
app.py — Vercel entrypoint. Vercel's Python runtime looks for an ASGI `app`
in app.py; the actual API lives in api.py (run locally with `python api.py`).
"""

from api import app  # noqa: F401
