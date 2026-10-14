# IBM Internship - Agentic Fact-Checker

This project consists of an AI-powered Fact-Checker Backend (Python/FastAPI) and a modern Frontend (React/Vite).

**Deploying it?** See [DEPLOY.md](DEPLOY.md) - Vercel for the frontend, a Docker
Space on Hugging Face for the backend, MongoDB Atlas for the database, all on
free tiers.

## Prerequisites
- Python 3.9+
- Node.js (v18+) or Bun
- MongoDB (Running locally or a remote MongoDB URI)

---

## 1. Running the Backend

The backend is built with FastAPI and utilizes Groq LLM + DuckDuckGo Search.

### Setup & Requirements
Navigate to the backend directory and install the requirements:
```bash
cd fact_checker_simple
pip install -r requirements.txt
```

### Environment Variables
Ensure you have a `.env` file in the `fact_checker_simple` directory containing:
```
GROQ_API_KEY=your_groq_api_key
MONGO_URI=mongodb://localhost:27017/ (or your remote URL)
GROQ_MODEL=qwen/qwen3.8-27b
```

`llama-3.3-70b-versatile`, the model this project used before, has been retired
by Groq; requests to it fail with `model_not_found`.

### Starting the Backend
Run the API server (prompts are seeded into MongoDB automatically on startup):
```bash
python api.py
```
The backend API will be available at: **http://localhost:8000**
You can access the Swagger documentation at: **http://localhost:8000/docs**

*(Alternatively, you can test a standalone script using `python main.py`)*

---

## 3. MADAM-RAG: agent debate verification and the paper replication

This repo implements MADAM-RAG from *Retrieval-Augmented Generation with
Conflicting Evidence* (Wang et al., COLM 2025; code and the RAMDocs dataset at
https://github.com/HanNight/RAMDocs). Each retrieved document gets its own
agent, the agents debate, and an aggregator keeps the answers that hold up
while dropping misinformation and noise.

It is used in two places:

- **The analyzer's "Agent debate" mode** (the default) verifies each claim
  this way, with a version tuned for news: syndicated copies of one story share
  an agent, sources that agree form a Supports or Refutes group, and the groups
  only argue when they disagree. It runs on its own model
  (`FACTCHECK_DEBATE_MODEL`, default `openai/gpt-oss-20b`) so debates can't use
  up the daily quota the quick check depends on.
- **The paper replication** (command line only): the paper's exact method and
  its baselines, scored on RAMDocs questions:

  ```bash
  cd fact_checker_simple
  python eval_ramdocs.py --sample 30          # MADAM-RAG + baselines on 30 random questions
  python eval_ramdocs.py --summary            # print results so far
  ```

  The script resumes where it stopped. On Groq's free tier a model gets about
  200k tokens a day, which is roughly 25 MADAM-RAG questions, so a sample takes
  a day or two.

Code: `madam_rag.py` (the paper's method, ported from `run_madam_rag.py`),
`madam_verify.py` (claim verification and the grouped debate), `ramdocs.py`
(dataset, metric, baselines), `eval_ramdocs.py`, and `frontend/src/features/debate/`.
Tests: `cd fact_checker_simple && python -m pytest tests -q`.

---

## 2. Running the Frontend

The frontend is a modern web application built using React, Vite, and TailwindCSS.

### Setup & Requirements
Navigate to the frontend directory and install dependencies. You can use `npm` or `bun`:

**Using npm:**
```bash
cd frontend
npm install
```

**Using Bun:**
```bash
cd frontend
bun install
```

### Starting the Frontend

Run the development server:
```bash
npm run dev
# or
bun run dev
```

The frontend will typically be accessible at: **http://localhost:5173** (check terminal output for the exact URL).
