# FactCheck AI — Full Workflow & Feature Documentation

An agentic fact-checker: paste a news article (or a single claim), and the system
extracts the factual claims, searches the live web for evidence, opens and reads
the actual source pages, and returns per-claim verdicts plus an overall
credibility score — all persisted to MongoDB and presented in a React frontend.

- **Backend**: Python / FastAPI / LangChain / Groq (`fact_checker_simple/`) — port **8000**
- **Frontend**: React 19 / TanStack Start / Tailwind v4 (`frontend/`) — port **8080** (dev)
- **Database**: MongoDB (`fact_checker` db)

---

# Part 1 — Backend

## 1.1 The fact-checking pipeline (`fact_checker.py`)

Every `POST /api/fact-check` runs this six-step pipeline:

```
article text
   │
   ▼
[1] CLAIM EXTRACTION        LLM (Groq GROQ_MODEL) + "claim_extraction" v3 prompt from MongoDB
   │                        → JSON array of atomic, verifiable claims (max_claims cap)
   ▼
[2] EVIDENCE SEARCH         per claim:
   │                          a. check MongoDB search cache (24h TTL, failures never cached)
   │                          b. LLM rephrases the claim into 3 varied search queries
   │                          c. each query → SerpAPI → Tavily → DuckDuckGo (first success wins)
   │                          d. DEEP SCRAPING: top 3 result URLs are downloaded,
   │                             HTML-stripped, and up to 2,500 chars of real page text
   │                             is attached as "SCRAPED SOURCE PAGE" evidence
   ▼
[3] CLAIM VERIFICATION      LLM + "claim_verification" v3 prompt from MongoDB
   │                        → per claim: SUPPORTS / REFUTES / NOT_ENOUGH_INFO
   │                          + confidence (0–1) + justification with source URLs
   ▼
[4] CREDIBILITY SCORE       deterministic math (no LLM):
   │                          SUPPORTS adds +confidence, REFUTES adds −confidence,
   │                          NOT_ENOUGH_INFO adds 0 → normalized to [0, 1]
   ▼
[5] OVERALL VERDICT         label computed DETERMINISTICALLY from the verdicts:
   │                          all claims undecided → UNVERIFIED
   │                          else by score: ≥0.8 TRUE · ≥0.6 MOSTLY TRUE · >0.4 MIXED
   │                                         · >0.2 MOSTLY FALSE · else FALSE
   │                        the LLM only writes the narrative (SUMMARY OF FINDINGS,
   │                        KEY EVIDENCE BREAKDOWN) consistent with that fixed label
   ▼
[6] PERSIST                 full result (claims, evidence, verdicts, score, verdict text,
                            article hash, model, prompt versions, duration) → MongoDB
```

### Key correctness principles

- **Evidence beats memory.** Every prompt receives today's date and explicit
  instructions that events after the LLM's training cutoff may already have
  happened — verdicts must come from the live search evidence, never from the
  model's memory. (Before this, the model marked "France lost to Spain, WC 2026"
  FALSE simply because its training data predated the tournament.)
- **"No evidence" ≠ "false."** A claim nobody could verify is
  `NOT_ENOUGH_INFO`, and an article full of them is `UNVERIFIED` — the pipeline
  can no longer emit a FALSE overall verdict without actual refuting evidence.
- **The overall label can't contradict the score.** It's computed from the same
  verdicts by code, not chosen freely by the LLM.
- **Failures are never cached.** A transient search-provider error used to
  poison the cache for 24 hours; now only real results are cached, and expiry
  is enforced on read.
- **ASCII-only console output.** On Windows, printing `✓` crashed with
  `UnicodeEncodeError` *inside* the search call — silently discarding good
  search results. All prints are ASCII and the server runs with
  `PYTHONIOENCODING=utf-8`.

## 1.2 Prompt management (`prompts.py`, `seed_prompts.py`)

Prompts are **data, not code**: stored in the `prompts` collection with
`name`, `version`, `template`, `is_active`. The pipeline always loads the
active version, so prompts can be upgraded without redeploying.

- `claim_extraction` v3 — what makes a claim verifiable, rejection rules,
  a "never return empty for headlines" rule, current-date awareness
- `claim_verification` v3 — verdict rules with confidence calibration,
  scraped-page priority, critical-thinking checklist, "evidence beats memory"

Upgrade flow: edit `seed_prompts.py`, run `python seed_prompts.py`
(deactivates old versions, activates the new ones).

## 1.3 REST API (`api.py`)

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/fact-check` | Run the pipeline (blocking). Body: `{article_text OR url, max_claims (1–10), force}`. If a **`url`** is given, the backend downloads the page and extracts the article text automatically. If the **identical article** was checked in the last hour, the saved result is returned instantly unless `force: true`. Optional `X-User-Email` header tags the result's owner. |
| `POST` | `/api/fact-check/stream` | Same input, but streams **real pipeline progress** as NDJSON — one JSON object per line: `{"event":"step","step":"extract"}`, `{"event":"claims","claims":[...]}`, per-claim `search` events with `current`/`total`, `verify`, `summarize`, then `{"event":"done","result":{...}}` (or `{"event":"error"}`). `{"event":"ping"}` is sent every 15s while a step is busy, so clients can tell a slow step from a dead connection. Dedup hits stream a single instant `done` event. |
| `GET` | `/api/history` | Newest-first list. Query params: `limit` (≤100), `offset`, `q` (case-insensitive text search). With `X-User-Email`, returns only that user's checks. |
| `GET` | `/api/fact-check/{id}` | Full saved result by Mongo `_id` (400 invalid id, 404 missing). |
| `DELETE` | `/api/fact-check/{id}` | Delete a result (400/404 on bad ids). |
| `GET` | `/api/stats` | Aggregates: total checks, average credibility, verdict distribution. Filtered per user when `X-User-Email` is sent. |
| `GET` | `/api/health` | Liveness **and** MongoDB ping: `{status, mongo, model, debate_model}`. |

Both fact-check endpoints also take `verification` (`standard` or `madam`).
With `madam`, the stream adds `sources` and `debate` events (one agent per
source, groups, advocates, aggregator) that drive the live debate view.

Other API behaviors:
- **Rate limiting**: max 6 pipeline runs per 5 minutes per client IP (dedup
  cache hits don't count) → `429` with a retry hint. Protects the paid
  Groq/search APIs from abuse.
- **Analyze by URL**: `fetch_article_text()` downloads the page, prefers
  `<article>`/`<p>` content, strips boilerplate, caps at 12,000 chars;
  `422` when no readable article can be extracted.
- **CORS** restricted to the local frontend origins (8080/5173) — no more `*`
- Swagger docs at `http://localhost:8000/docs`
- `X-User-Email` is demo-grade ownership, **not** authentication — see
  `BACKEND_IDEAS.md` for the real-auth upgrade path

## 1.4 MongoDB collections (`db.py`, `models.py`)

| Collection | Contents | Indexes |
|---|---|---|
| `fact_checks` | One doc per pipeline run: article text + hash, claims, raw evidence, verdicts, score, overall verdict, model, prompt versions, duration, `created_at`, optional `user_id` | `article_hash`, `created_at` |
| `search_cache` | Cached search results keyed by claim hash, 24h TTL | unique `query_hash`, TTL on `expires_at` |
| `prompts` | Versioned prompt templates | unique `(name, version)`, `(name, is_active)` |

## 1.5 Configuration (`.env` in `fact_checker_simple/`)

```
GROQ_API_KEY=...            # required — LLM
MONGO_URI=...               # required — MongoDB
MONGO_DB=fact_checker
GROQ_MODEL=qwen/qwen3.8-27b          # llama-3.3-70b-versatile is retired on Groq
FACTCHECK_DEBATE_MODEL=openai/gpt-oss-20b   # agent debate (separate daily quota)
FACTCHECK_DEBATE_STRATEGY=grouped           # or "paper"
MADAM_MODEL=                                # eval_ramdocs.py; defaults to GROQ_MODEL
SERPAPI_API_KEY=...         # search provider #1 (optional)
TAVILY_API_KEY=...          # search provider #2 (optional)
SEARCH_CACHE_TTL_HOURS=24
```

## 1.6 Running the backend

```bash
cd fact_checker_simple
pip install -r requirements.txt
python seed_prompts.py        # once, and after any prompt upgrade
python api.py                 # serves http://localhost:8000
```

---

# Part 2 — Frontend

## 2.1 Architecture

- **TanStack Start** (file-based routing + SSR) with **React 19**
- **TanStack Query** for all server state (queries keyed per user)
- **Tailwind v4** + shadcn-style components, glassmorphism design, light/dark theme
- `src/lib/api.ts` — typed API client; every response validated with **zod**;
  falls back to a **mock mode** when `VITE_API_BASE_URL` is unset (demo without backend)
- `src/lib/user-store.ts` — per-user client-side data layer (below)
- `src/lib/auth.tsx` — session context (Google OAuth popup or email/password, demo-grade)

## 2.2 Per-user data model

The app keeps **every user's data separate** in namespaced localStorage
(`factcheck.u.<email>` — guests get `factcheck.u.guest`):

| Data | What's stored |
|---|---|
| History | Every analysis the user ran (snippet, score, date, pinned flag), capped at 100 |
| Full results | Complete result payloads for the 50 most recent checks → history detail loads **instantly and offline** |
| Preferences | Default max-claims, draft-autosave toggle |
| Draft | Unsent article text, restored after refresh |

Signing in/out switches the namespace, so two accounts on the same machine never
see each other's history. The signed-in email is also sent to the backend
(`X-User-Email`) so the server copy is tagged with its owner.

## 2.3 Pages & features

### `/` — Sign in
- Google OAuth popup flow or email/password (demo)
- "Continue without signing in" → full guest mode with its own local history

### `/analyze` — the analyzer (home)
- **Two input modes**: paste article text, or **give a URL** — the backend
  fetches the page and extracts the article automatically
- Article textarea with live word/char count, min/max validation,
  **paste-from-clipboard**, **clear**, **sample article**, **Ctrl+Enter** submit
- **Draft autosave** (debounced) — refresh-proof
- Max-claims slider (1–10), default taken from the user's saved preference
- During analysis: **REAL streamed progress** — the steps panel shows the
  actual pipeline phase, the number of claims found, and which claim
  (2/5, 3/5, …) is being searched right now; **Cancel** button aborts the
  stream; a 90s idle watchdog catches stalled connections; automatic retry ×1
- Results: score ring + honest band label (says *"could not be verified"* when
  the pipeline decided nothing, instead of pretending it's "mixed"),
  AI Investigation Summary (parsed OVERALL VERDICT / SUMMARY OF FINDINGS /
  KEY EVIDENCE BREAKDOWN sections), per-claim cards with verdict chip,
  confidence bar, and clickable source links
- **Export**: copy full Markdown report, download `.md`, download `.json`
- Recent-checks sidebar (pinned items first)

- **How claims are checked**: *Quick check* (one LLM call judges every claim)
  or *Agent debate* (MADAM-RAG, the default). In debate mode each claim's
  sources are seated at a live debate table: seats take each agent's stance,
  agreeing sources move together into Supports and Refutes groups, each
  group's advocate argues its case, and the aggregator's ruling is drawn on the
  spokes (relied on, flagged, ignored). After the run, a collapsible "How the
  sources debated" section on the results page keeps every claim's debate
  (table, transcript, how positions shifted, ruling) and can replay it.

### `/history` — your history
- **Stats row**: total checks, average credibility, credible count, low count
- **Search** across your checks + **band filters** (Credible ≥70% / Mixed / Low)
- **Pin** important checks to the top, **delete** individual checks
  (also removed from the server DB), **Clear all**

### `/history/:id` — saved result
- Loads from the local per-user cache first (instant), falls back to the API
- Shows the original article + full result view (same exports)
- **Re-check this article** — loads the article back into the analyzer

### `/settings`
- Appearance: light/dark (toasts follow the theme)
- **Analysis preferences**: default max claims, draft autosave
- **Your data**: export *all* your data as JSON, clear history
- Profile display + sign out

## 2.4 Request lifecycle (what happens when you click Analyze)

```
InputForm (validate text or URL) ──► useMutation ──► api.analyzeArticleStream()
                                           │  POST /api/fact-check/stream (NDJSON)
                                           │  headers: X-User-Email (if signed in)
                                           │  90s idle watchdog + AbortController (Cancel)
                                           │
                                           ├──► progress events drive ProcessingSteps
                                           │    (extract → N claims → search 1/N…N/N
                                           │     → verify → summarize)
                                           ▼
                        zod-validate the final "done" result
                                           │
              ┌────────────────────────────┼──────────────────────────┐
              ▼                            ▼                          ▼
      ResultView renders        user-store.recordResult()     query invalidation
      (score, sections,         (per-user history + full      (sidebar & history
       claims, exports)          result cached locally)         page refresh)
```

## 2.5 Running the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:8080
```

`.env`: `VITE_API_BASE_URL=http://localhost:8000` (unset → mock mode),
`VITE_GOOGLE_CLIENT_ID=...` for Google sign-in.

---

# Part 3 — Data-flow summary (end to end)

1. User signs in (or continues as guest) → frontend derives the user namespace.
2. User pastes an article → draft autosaved locally as they type.
3. Analyze → `POST /api/fact-check` with the user's email header.
4. Backend dedupes identical recent articles, else runs the 6-step pipeline
   (extract → search+scrape → verify → score → overall verdict → persist).
5. Response is zod-validated, rendered, and recorded into the user's local
   history; the server document carries their `user_id`.
6. History pages read the local per-user store (instant, offline-capable);
   detail views fall back to `GET /api/fact-check/{id}` when needed.
7. Deleting a check removes it locally **and** from MongoDB.

# Part 4 — Known limitations

- `X-User-Email` is trust-based, not verified auth (upgrade path in `BACKEND_IDEAS.md`).
- Local history doesn't sync across devices (needs real accounts + server reads).
- URL extraction is regex-based; unusual page layouts may extract noisy text
  (a proper readability library would improve this).
- Rate limiting is in-memory per process — resets on restart, not shared
  across multiple workers.
- Search quality depends on provider keys (SerpAPI → Tavily → DuckDuckGo fallback order).
- Groq's free tier caps each model at roughly 200k tokens a day. A daily-limit
  error stops immediately with a clear message rather than retrying.
- The replication uses Qwen or gpt-oss, because the paper's Llama-3.3-70B is
  retired on Groq, and a random sample of RAMDocs rather than all 500 questions.
  Compare how the methods rank, not the exact numbers.
