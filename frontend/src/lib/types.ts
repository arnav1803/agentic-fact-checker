export type VerdictKind = "SUPPORTS" | "REFUTES" | "NOT_ENOUGH_INFO";

/** Questions are answered from web sources; everything else is fact-checked. */
export type AnalysisMode = "fact_check" | "answer";

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
  mode?: AnalysisMode;
  /** Answer mode: markdown answer whose [n] citations link into `sources`. */
  answer?: string;
  sources?: string[];
}

export interface HistoryItem {
  _id: string;
  article_text: string;
  credibility_score: number;
  created_at: string;
  mode?: AnalysisMode;
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
  event: "mode" | "step" | "claims" | "queries" | "done" | "error";
  mode?: AnalysisMode;
  step?: AnalysisPhase;
  current?: number;
  total?: number;
  claim?: string;
  /** Answer mode: the web search currently running. */
  query?: string;
  claims?: string[];
  queries?: string[];
  detail?: string;
  result?: unknown;
}

/** Aggregated progress state consumed by the ProcessingSteps UI. */
export type AnalysisPhase = "extract" | "search" | "verify" | "summarize" | "plan" | "answer";

export interface AnalysisProgress {
  mode?: AnalysisMode;
  phase: AnalysisPhase;
  query?: string;
  queries?: string[];
  searchCurrent?: number;
  searchTotal?: number;
  claim?: string;
  claims?: string[];
}
