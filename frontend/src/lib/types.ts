export type VerdictKind = "SUPPORTS" | "REFUTES" | "NOT_ENOUGH_INFO";

export interface Verdict {
  claim: string;
  verdict: VerdictKind;
  confidence: number;
  justification: string;
}

export interface FactCheckResult {
  _id: string;
  claims: string[];
  verdicts: Verdict[];
  credibility_score: number;
  overall_verdict?: string;
  duration_seconds: number;
  model?: string;
  article_text?: string;
  created_at?: string;
}

export interface HistoryItem {
  _id: string;
  article_text: string;
  credibility_score: number;
  created_at: string;
}

export interface FactCheckRequest {
  article_text?: string;
  /** Alternative to article_text: a news article URL the backend fetches */
  url?: string;
  max_claims: number;
  /** Re-run the pipeline even if this exact article was checked recently */
  force?: boolean;
}

/** Real-time pipeline progress, streamed as NDJSON from the backend. */
export interface StreamEvent {
  event: "step" | "claims" | "done" | "error";
  step?: "extract" | "search" | "verify" | "summarize";
  current?: number;
  total?: number;
  claim?: string;
  claims?: string[];
  detail?: string;
  result?: unknown;
}

/** Aggregated progress state consumed by the ProcessingSteps UI. */
export interface AnalysisProgress {
  phase: "extract" | "search" | "verify" | "summarize";
  searchCurrent?: number;
  searchTotal?: number;
  claim?: string;
  claims?: string[];
}
