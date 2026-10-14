---
title: Agentic Fact Checker API
emoji: 🔎
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Agentic Fact-Checker API

FastAPI backend that verifies news articles with a Groq LLM plus live web
search, storing every run in MongoDB.

The YAML block above is [Hugging Face Space](https://huggingface.co/docs/hub/spaces-config-reference)
configuration — it is ignored everywhere else, so this file doubles as the
backend README and the Space manifest.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fact-check` | Run the pipeline on an article (blocking) |
| POST | `/api/fact-check/stream` | Same, streaming NDJSON progress events |
| GET | `/api/history` | Recent fact-checks (pagination, search, per-user) |
| GET | `/api/fact-check/{id}` | One fact-check by id |
| DELETE | `/api/fact-check/{id}` | Delete a fact-check |
| GET | `/api/stats` | Totals, average credibility, verdict spread |
| GET | `/api/health` | Liveness + MongoDB ping |

Interactive docs are at `/docs`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | yes | https://console.groq.com |
| `MONGO_URI` | yes | MongoDB Atlas connection string |
| `TAVILY_API_KEY` | strongly recommended | Search provider that works from datacenter IPs — see below |
| `CORS_ORIGINS` | yes, in production | Comma-separated frontend origins, e.g. `https://your-app.vercel.app` |
| `MONGO_DB` | no | Defaults to `fact_checker` |
| `GROQ_MODEL` | no | Defaults to `llama-3.3-70b-versatile` |
| `SERPAPI_API_KEY` | no | First-choice search provider when set |
| `CORS_ORIGIN_REGEX` | no | Defaults to `https://.*\.vercel\.app` (preview deploys) |
| `AUTO_SEED_PROMPTS` | no | Set `false` to stop seeding prompts on startup |
| `PORT` | no | 7860 in the container, 8000 locally |

### A note on search providers

The pipeline tries SerpAPI → Tavily → DuckDuckGo in order. DuckDuckGo is the
only one that needs no key, but it rate-limits and blocks datacenter IP ranges,
which is exactly where a deployed backend lives. **Set `TAVILY_API_KEY` on any
deployment** (its free tier covers 1,000 searches/month) or the pipeline will
fall back to "No search results found" and return `NOT_ENOUGH_INFO` for
everything.

## Running locally

```bash
pip install -r requirements.txt
python api.py            # http://localhost:8000
```

Prompt templates are seeded into MongoDB automatically on startup; running
`python seed_prompts.py` by hand is only needed if you disable that.

## Running the container

```bash
docker build -t fact-checker-api .
docker run -p 7860:7860 --env-file .env fact-checker-api
```

## Notes for a real deployment

- Rate limiting is in-process, so it resets on restart and is per-instance.
- The `X-User-Email` header is a demo-grade ownership tag, **not** authentication —
  a client can send any address. Swap in verified ID tokens before this holds
  anything private.
