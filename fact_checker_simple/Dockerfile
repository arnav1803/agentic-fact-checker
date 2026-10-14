# Backend container for the Agentic Fact-Checker API.
#
# Runs as-is on Hugging Face Spaces (Docker SDK, port 7860), and on any host
# that injects $PORT (Render, Railway, Fly.io, Cloud Run) with no changes.

FROM python:3.11-slim

# Faster, quieter, no .pyc clutter in the image
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so code edits don't invalidate the pip layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces runs the container as a non-root user (uid 1000) and
# expects the app on 7860. Other hosts override PORT.
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=7860
EXPOSE 7860

# Prompts are auto-seeded into MongoDB on startup (see api.py).
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-7860}"]
