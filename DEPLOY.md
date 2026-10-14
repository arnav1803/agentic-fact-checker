# Deploying the Agentic Fact-Checker

Target setup — all free tiers:

| Piece | Host | URL shape |
|---|---|---|
| Frontend (TanStack Start) | Vercel | `https://agentic-fact-checker.vercel.app` |
| Backend (FastAPI) | Hugging Face Spaces (Docker) | `https://<user>-fact-checker-api.hf.space` |
| Database | MongoDB Atlas M0 | `mongodb+srv://…` |

There is a deliberate ordering here: the frontend needs the backend's URL at
**build time**, and the backend needs the frontend's URL for CORS. So the
backend goes up first with a placeholder, and step 4 comes back to fix CORS.

---

## 1. MongoDB Atlas (~5 min)

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user with a password. Avoid `@ : / ?` in the
   password, or URL-encode it in the connection string.
3. **Network Access** → add `0.0.0.0/0`. Hugging Face and Vercel don't publish
   fixed egress IPs, so an allowlist isn't an option here.
4. **Connect → Drivers** → copy the `mongodb+srv://…` string and substitute the
   real password.

Collections and indexes are created automatically on first connection
(`db.py`), and the prompt templates are seeded on API startup — nothing to
import by hand.

## 2. Backend → Hugging Face Space

1. Create a Space at <https://huggingface.co/new-space>:
   **SDK: Docker → Blank**, hardware **CPU basic (free)**.
2. Push the backend folder as the Space root:

   ```bash
   git clone https://huggingface.co/spaces/<user>/fact-checker-api hf-space
   cp -r fact_checker_simple/* hf-space/
   cd hf-space && git add -A && git commit -m "Deploy fact-checker API" && git push
   ```

   Use your HF **write token** (Settings → Access Tokens) as the password when
   git prompts. `fact_checker_simple/README.md` carries the `sdk: docker` /
   `app_port: 7860` front-matter the Space needs, and `.dockerignore` keeps
   `.env` out of the image.

3. Space **Settings → Variables and secrets**:

   | Name | Kind | Value |
   |---|---|---|
   | `GROQ_API_KEY` | secret | from <https://console.groq.com> |
   | `MONGO_URI` | secret | the Atlas string from step 1 |
   | `TAVILY_API_KEY` | secret | from <https://tavily.com> — see the warning below |
   | `CORS_ORIGINS` | variable | `http://localhost:5173` for now; fixed in step 4 |
   | `GROQ_MODEL` | variable | `qwen/qwen3.8-27b` (the old default, `llama-3.3-70b-versatile`, is retired) |

4. Wait for the build, then confirm:
   `https://<user>-fact-checker-api.hf.space/api/health` → `{"status":"ok","mongo":"up",…}`.
   `/docs` gives you the Swagger UI.

> **Set `TAVILY_API_KEY`.** The pipeline tries SerpAPI → Tavily → DuckDuckGo.
> DuckDuckGo is the keyless fallback, but it blocks datacenter IPs — which is
> what every host here runs on. Without a Tavily key the searches come back
> empty and every claim gets a `NOT_ENOUGH_INFO` verdict, which looks like the
> AI is broken rather than the search layer. Tavily's free tier is 1,000
> searches/month; each article uses roughly one per claim.

## 3. Frontend → Vercel

1. <https://vercel.com/new> → import `arnav1803/agentic-fact-checker`.
2. **Root Directory: `frontend`** — this is the setting people miss; the build
   fails without it.
3. Framework Preset: **Other**. The build command and install command come from
   `frontend/vercel.json`, and Nitro emits Vercel's Build Output API format
   (`.vercel/output`), which Vercel picks up on its own.
4. **Environment Variables** → add, for all environments:

   ```
   VITE_API_BASE_URL = https://<user>-fact-checker-api.hf.space
   ```

   No trailing slash. Vite inlines `VITE_*` values at build time, so changing
   this later needs a redeploy, not just a restart. If it's left empty the UI
   silently runs on built-in mock data — a useful fallback, and an easy thing to
   mistake for a working deploy.
5. Deploy, and note the production URL.

## 4. Close the CORS loop

Back in the Space's **Variables and secrets**, set:

```
CORS_ORIGINS = https://<your-project>.vercel.app
```

Restart the Space (Settings → Factory rebuild isn't needed; **Restart this
Space** is enough). Vercel preview deployments on `*.vercel.app` are already
covered by the `CORS_ORIGIN_REGEX` default, so only the production domain and
any custom domain need listing here.

Verify end to end: open the Vercel URL, paste an article, and watch the
progress steps stream. If the analysis fails with a network error, open the
browser console — a CORS message means step 4 didn't take effect.

---

## What to expect from the free tiers

- **Space sleeping.** A free Space sleeps after **48 hours** with no traffic and
  takes ~30–60 s to wake. That's fine for a demo but worth knowing before you
  open it in front of an audience — hit the URL once beforehand.
- **Atlas pausing.** M0 clusters pause after 60 days of inactivity and need a
  click in the Atlas UI to resume.
- **The Space is public.** The code is visible (secrets are not), and anyone who
  finds the URL can call the API and spend your Groq and Tavily quota. The
  built-in rate limiter caps 6 pipeline runs per IP per 5 minutes, which blunts
  casual abuse but is per-instance and resets on restart. Set the Space to
  private if that matters, and point `VITE_API_BASE_URL` at it — private Spaces
  require an auth header, so you'd need a proxy route in the frontend.
- **Groq's daily caps.** Each model gets roughly 200k tokens a day on the free
  tier. The agent debate runs on its own model (`FACTCHECK_DEBATE_MODEL`), so a
  busy day of debates can't stop quick checks from working.
- **Auth is not real.** `X-User-Email` is a client-supplied ownership tag, so
  history is separated but not protected — any client can claim any address.
  Don't put anything private in there until it's swapped for verified tokens.

## Switching hosts later

The backend is a plain container, so the same `Dockerfile` runs unchanged on
Render, Railway, Fly.io, or Cloud Run — they inject `$PORT` and the image
honours it. Render's free tier sleeps after 15 minutes rather than 48 hours,
which is the main reason it isn't the default here.

For the frontend, the Nitro preset is pinned in `frontend/vite.config.ts`;
change `preset: "vercel"` to `"netlify"` or drop the `nitro` option entirely to
go back to the Cloudflare Workers default.

## Keeping the Space in sync

The Space is a separate git remote, so backend changes need pushing twice. From
the repo root:

```bash
cp -r fact_checker_simple/* ../hf-space/
cd ../hf-space && git add -A && git commit -m "Sync backend" && git push
```

Wiring this into a GitHub Action (`huggingface/huggingface_hub` provides one) is
the tidier long-term answer if the backend changes often.
