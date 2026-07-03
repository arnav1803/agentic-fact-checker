# IBM Internship - Agentic Fact-Checker

This project consists of an AI-powered Fact-Checker Backend (Python/FastAPI) and a modern Frontend (React/Vite).

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
```

### Starting the Backend
First, seed the prompts to the database (only needed once):
```bash
python seed_prompts.py
```

Then, run the API server:
```bash
python api.py
```
The backend API will be available at: **http://localhost:8000**
You can access the Swagger documentation at: **http://localhost:8000/docs**

*(Alternatively, you can test a standalone script using `python main.py`)*

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
