import { z } from "zod";
import type {
  ClaimDebate,
  DebateEvent,
  DebateSource,
  FactCheckRequest,
  FactCheckResult,
  HistoryItem,
  StreamEvent,
  Verdict,
} from "./types";
import { MOCK_EVENT_DELAY, mockClaimDebate, mockClaimSources } from "./mock-debate";

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
export const USE_MOCK = !BASE_URL;

const verdictSchema = z.object({
  claim: z.string(),
  verdict: z.enum(["SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO"]),
  confidence: z.number().min(0).max(1),
  justification: z.string(),
});

const factCheckResultSchema = z.object({
  _id: z.string(),
  claims: z.array(z.string()),
  verdicts: z.array(verdictSchema),
  credibility_score: z.number().min(0).max(1),
  overall_verdict: z.string().optional(),
  duration_seconds: z.number(),
  model: z.string().optional(),
  article_text: z.string().optional(),
  created_at: z.string().optional(),
  verification_method: z.enum(["standard", "madam"]).optional(),
  // Debate records are large and nested; check the envelope, trust the rest.
  debates: z
    .array(
      z.object({
        claim_index: z.number(),
        claim: z.string(),
        sources: z.array(z.object({ agent: z.number(), text: z.string() }).passthrough()),
        record: z
          .object({ rounds: z.array(z.array(z.any())) })
          .passthrough()
          .nullable(),
        model: z.string().optional(),
      }),
    )
    .optional()
    .transform((d) => d as ClaimDebate[] | undefined),
  mode: z.enum(["fact_check", "answer"]).optional(),
  answer: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

const historyItemSchema = z.object({
  _id: z.string(),
  article_text: z.string(),
  credibility_score: z.number(),
  created_at: z.string(),
  mode: z.enum(["fact_check", "answer"]).optional(),
});

// ---------- Mock store ----------
const HISTORY_KEY = "factcheck.history.v1";
const RESULT_KEY = (id: string) => `factcheck.result.${id}`;

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : seedHistory();
  } catch {
    return [];
  }
}
function saveHistory(items: HistoryItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}
function saveResult(res: FactCheckResult) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESULT_KEY(res._id), JSON.stringify(res));
}
function loadResult(id: string): FactCheckResult | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(RESULT_KEY(id));
  return raw ? (JSON.parse(raw) as FactCheckResult) : null;
}

function seedHistory(): HistoryItem[] {
  const seeds: FactCheckResult[] = [
    {
      _id: "seed-1",
      claims: [
        "The Indian government announced a ₹10,000 crore AI fund.",
        "First grants will be disbursed by December 2026.",
      ],
      verdicts: [
        {
          claim: "The Indian government announced a ₹10,000 crore AI fund.",
          verdict: "SUPPORTS",
          confidence: 0.86,
          justification:
            "Multiple mainstream outlets reported the Union Cabinet approving an AI mission of similar scale. https://example.com/ai-fund",
        },
        {
          claim: "First grants will be disbursed by December 2026.",
          verdict: "NOT_ENOUGH_INFO",
          confidence: 0.42,
          justification:
            "Timeline was mentioned in a press briefing but no official disbursement schedule has been published.",
        },
      ],
      credibility_score: 0.72,
      duration_seconds: 8.2,
      model: "llama-3.3-70b-versatile",
      article_text:
        "The Indian government announced today that it will launch a ₹10,000 crore fund to support AI startups...",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    },
  ];
  const hist = seeds.map((s) => {
    saveResult(s);
    return {
      _id: s._id,
      article_text: s.article_text!.slice(0, 200),
      credibility_score: s.credibility_score,
      created_at: s.created_at!,
    };
  });
  saveHistory(hist);
  return hist;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    });
  });
}

function mockAnalyze(req: FactCheckRequest, debates?: ClaimDebate[]): FactCheckResult {
  const articleText = req.article_text ?? "";
  const sentences = articleText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const claims = sentences.slice(0, req.max_claims);
  const kinds: FactCheckResult["verdicts"][number]["verdict"][] = [
    "SUPPORTS",
    "REFUTES",
    "NOT_ENOUGH_INFO",
  ];
  const verdicts: Verdict[] = claims.map((claim, i) => {
    const debated = debates?.[i]?.record?.final;
    if (debated?.verdict) {
      return {
        claim,
        verdict: debated.verdict,
        confidence: debated.confidence ?? 0.5,
        justification: `${debated.explanation}\nSources: ${debates![i].sources
          .filter((s) => debated.reliable_agents?.includes(s.agent))
          .map((s) => s.url)
          .join(" ")}`,
      };
    }
    const verdict = kinds[i % kinds.length];
    const confidence =
      verdict === "SUPPORTS"
        ? 0.7 + Math.random() * 0.25
        : verdict === "REFUTES"
          ? 0.55 + Math.random() * 0.3
          : 0.3 + Math.random() * 0.25;
    return {
      claim,
      verdict,
      confidence: Number(confidence.toFixed(2)),
      justification:
        verdict === "SUPPORTS"
          ? `Corroborated by multiple independent sources. See https://example.com/source-${i + 1} for context.`
          : verdict === "REFUTES"
            ? `Contradicted by primary reporting from https://example.com/refute-${i + 1}.`
            : `Insufficient public evidence to confirm or deny this claim as stated.`,
    };
  });
  const avg =
    verdicts.length === 0
      ? 0
      : verdicts.reduce(
          (a, v) =>
            a +
            (v.verdict === "SUPPORTS"
              ? v.confidence
              : v.verdict === "REFUTES"
                ? 1 - v.confidence
                : 0.5),
          0,
        ) / verdicts.length;
  const id = `fc-${Date.now()}`;
  const result: FactCheckResult = {
    _id: id,
    claims,
    verdicts,
    credibility_score: Number(avg.toFixed(2)),
    overall_verdict: "This is a mock analysis. Connect to the backend for real AI verdicts.",
    duration_seconds: Number((2 + Math.random() * 2).toFixed(1)),
    model: "qwen/qwen3.8-27b (mock)",
    article_text: articleText,
    created_at: new Date().toISOString(),
    verification_method: debates ? "madam" : "standard",
    debates,
  };
  saveResult(result);
  const hist = loadHistory();
  hist.unshift({
    _id: id,
    article_text: articleText.slice(0, 200),
    credibility_score: result.credibility_score,
    created_at: result.created_at!,
  });
  saveHistory(hist);
  return result;
}

// ---------- Public API ----------
async function fetchJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw await responseError(res);
  }
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Malformed response from server");
  }
  return parsed.data;
}

/** Demo-grade ownership tag: the backend stores this email as `user_id`. */
function userHeaders(userEmail?: string): Record<string, string> {
  return userEmail && userEmail !== "guest" ? { "X-User-Email": userEmail } : {};
}

/** Build an Error from a non-2xx response (FastAPI puts messages in `detail`). */
async function responseError(res: Response): Promise<Error & { status?: number }> {
  let msg = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") msg = body.detail;
    else if (typeof body?.message === "string") msg = body.message;
  } catch {
    /* ignore */
  }
  const err = new Error(msg) as Error & { status?: number };
  err.status = res.status;
  return err;
}

export async function analyzeArticle(
  req: FactCheckRequest,
  signal?: AbortSignal,
  userEmail?: string,
): Promise<FactCheckResult> {
  if (USE_MOCK) {
    await delay(2500, signal);
    return mockAnalyze(req);
  }
  return fetchJson(
    `${BASE_URL}/api/fact-check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userHeaders(userEmail) },
      body: JSON.stringify(req),
      signal,
    },
    factCheckResultSchema,
  );
}

/**
 * Streaming analysis: POSTs to /api/fact-check/stream and reports REAL
 * pipeline progress via `onEvent` as NDJSON events arrive. Resolves with the
 * final validated result. In mock mode the progress is simulated.
 */
export async function analyzeArticleStream(
  req: FactCheckRequest,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  userEmail?: string,
): Promise<FactCheckResult> {
  if (USE_MOCK) {
    if (!req.article_text?.trim()) {
      const err = new Error("Analyzing by URL requires the backend to be running") as Error & {
        status?: number;
      };
      err.status = 400;
      throw err;
    }
    const debate = req.verification === "madam";
    const claims = (req.article_text ?? "")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, req.max_claims);
    onEvent({ event: "step", step: "extract" });
    await delay(700, signal);
    onEvent({ event: "claims", claims });
    const sources: DebateSource[][] = [];
    for (let i = 0; i < claims.length; i++) {
      onEvent({
        event: "step",
        step: "search",
        current: i + 1,
        total: claims.length,
        claim: claims[i],
      });
      await delay(debate ? 450 : 600, signal);
      if (debate) {
        sources.push(mockClaimSources(claims[i]));
        onEvent({ event: "sources", claim_index: i, sources: sources[i] });
      }
    }
    onEvent({ event: "step", step: "verify" });
    let debates: ClaimDebate[] | undefined;
    if (debate) {
      debates = [];
      for (let i = 0; i < claims.length; i++) {
        let record: ClaimDebate["record"] = null;
        for (const ev of mockClaimDebate(claims[i])) {
          if (ev.type === "debate_end") record = ev.record;
          onEvent({ event: "debate", claim_index: i, ...ev });
          await delay(MOCK_EVENT_DELAY[ev.type], signal);
        }
        debates.push({ claim_index: i, claim: claims[i], sources: sources[i], record });
      }
    } else {
      await delay(400, signal);
    }
    onEvent({ event: "step", step: "summarize" });
    await delay(300, signal);
    return mockAnalyze(req, debates);
  }

  const res = await fetch(`${BASE_URL}/api/fact-check/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders(userEmail) },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw await responseError(res);

  let final: FactCheckResult | null = null;
  await readNdjson<StreamEvent>(res, (ev) => {
    if (ev.event === "error") {
      // The server finished with a failure; rerunning the same request would
      // usually fail the same way and spend the quota twice, so it isn't retried.
      const err = new Error(ev.detail || "Pipeline error");
      err.name = "PipelineError";
      throw err;
    }
    if (ev.event === "done") {
      const parsed = factCheckResultSchema.safeParse(ev.result);
      if (!parsed.success) throw new Error("Malformed response from server");
      final = parsed.data;
      return;
    }
    onEvent(ev);
  });

  if (!final) throw new Error("The analysis stream ended unexpectedly");
  return final;
}

/** Feed each JSON line of an NDJSON response body to `onLine`. */
export async function readNdjson<T>(res: Response, onLine: (value: T) => void): Promise<void> {
  if (!res.body) throw new Error("Streaming is not supported by this browser");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (line: string) => {
    if (!line.trim()) return;
    let value: T;
    try {
      value = JSON.parse(line) as T;
    } catch {
      return; // skip malformed line
    }
    onLine(value);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handle(line);
    }
  }
  handle(buffer); // trailing line without newline
}

export { delay, responseError };

/** Delete a fact-check from the server DB. No-op in mock mode. */
export async function deleteFactCheck(id: string): Promise<void> {
  if (USE_MOCK) return;
  try {
    await fetch(`${BASE_URL}/api/fact-check/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {
    // Local deletion already happened; server cleanup is best-effort.
  }
}

export async function getHistory(signal?: AbortSignal): Promise<HistoryItem[]> {
  if (USE_MOCK) {
    await delay(400, signal);
    return loadHistory();
  }
  return fetchJson(`${BASE_URL}/api/history`, { signal }, z.array(historyItemSchema));
}

export async function getFactCheck(id: string, signal?: AbortSignal): Promise<FactCheckResult> {
  if (USE_MOCK) {
    await delay(400, signal);
    const found = loadResult(id);
    if (!found) {
      const err = new Error("Fact-check not found") as Error & {
        status?: number;
      };
      err.status = 404;
      throw err;
    }
    return found;
  }
  return fetchJson(
    `${BASE_URL}/api/fact-check/${encodeURIComponent(id)}`,
    { signal },
    factCheckResultSchema,
  );
}
