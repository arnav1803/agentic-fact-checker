export type VerdictKind = "SUPPORTS" | "REFUTES" | "NOT_ENOUGH_INFO";

/** Questions are answered from web sources; everything else is fact-checked. */
export type AnalysisMode = "fact_check" | "answer";

export interface Verdict {
  claim: string;
  verdict: VerdictKind;
  confidence: number;
  justification: string;
}

export type VerificationMethod = "standard" | "madam";

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
  verification_method?: VerificationMethod;
  /** MADAM-RAG only: one debate per claim */
  debates?: ClaimDebate[];
  mode?: AnalysisMode;
  /** Answer mode: markdown answer whose [n] citations link into `sources`. */
  answer?: string;
  sources?: string[];
}

// ---------- MADAM-RAG debate ----------

/** One retrieved document = one agent at the debate table. */
export interface DebateSource {
  agent: number;
  text: string;
  title?: string;
  url?: string;
  domain?: string;
  scraped?: boolean;
  /** Other sites that ran the same report (syndicated copies share one agent) */
  also?: { domain: string; url: string }[];
  /** RAMDocs ground truth (lab only) */
  type?: "correct" | "misinfo" | "noise";
  answer?: string;
}

export interface AgentTurn {
  agent: number;
  round: number;
  answer: string;
  explanation: string;
  /** Claim verification only; QA debates have answers instead */
  verdict?: VerdictKind | null;
  changed: boolean;
  raw?: string;
}

export interface Aggregation {
  round: number;
  raw?: string;
  answers: string[];
  explanation: string;
  // Claim verification only
  verdict?: VerdictKind;
  confidence?: number;
  reliable_agents?: number[];
  unreliable_agents?: number[];
  irrelevant_agents?: number[];
  ambiguity?: string;
  /** Set when the aggregator's output was unusable even after a retry */
  rejected?: string;
}

/** Grouped debate: agents that reached the same verdict in round 1 */
export interface DebateCamp {
  stance: VerdictKind;
  members: number[];
}

/** A group's advocate after hearing the other group */
export interface CampTurn {
  camp: number;
  stance: VerdictKind;
  members: number[];
  verdict: VerdictKind;
  answer: string;
  explanation: string;
  conceded: boolean;
}

export type DebateStrategy = "grouped" | "paper";

export interface DebateRecord {
  /** "grouped" (news fact-checks) or the paper's per-agent rounds; absent = paper */
  mode?: DebateStrategy;
  camps?: DebateCamp[];
  set_aside?: number[];
  camp_turns?: CampTurn[];
  num_agents: number;
  max_rounds: number;
  rounds_used: number;
  converged: boolean;
  converged_round: number | null;
  rounds: AgentTurn[][];
  aggregations: Aggregation[];
  final: Aggregation | null;
}

export interface ClaimDebate {
  claim_index: number;
  claim: string;
  sources: DebateSource[];
  record: DebateRecord | null;
  model?: string;
}

/** Events from madam_rag.run_debate, streamed as NDJSON. */
export type DebateEvent =
  | { type: "debate_start"; num_agents: number; max_rounds: number; mode?: DebateStrategy }
  | { type: "round_start"; round: number }
  | { type: "agent_thinking"; round: number; agent: number }
  | ({ type: "agent_response" } & AgentTurn)
  | { type: "aggregator_thinking"; round: number }
  | { type: "aggregation"; round: number; aggregation: Aggregation }
  | { type: "converged"; round: number }
  | { type: "camps"; round: number; camps: DebateCamp[]; set_aside: number[] }
  | { type: "camp_thinking"; round: number; camp: number; members: number[] }
  | ({ type: "camp_response"; round: number } & CampTurn)
  | { type: "debate_end"; record: DebateRecord }
  | { type: "debate_failed"; detail: string };

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
  verification?: VerificationMethod;
  /** MADAM-RAG debate rounds, 1-3 */
  debate_rounds?: number;
}

/** Real-time pipeline progress, streamed as NDJSON from the backend. */
export type StreamEvent =
  | { event: "mode"; mode: AnalysisMode }
  | {
      event: "step";
      step: AnalysisPhase;
      current?: number;
      total?: number;
      claim?: string;
      /** Answer mode: the web search currently running. */
      query?: string;
    }
  | { event: "claims"; claims: string[] }
  | { event: "queries"; queries: string[] }
  | { event: "sources"; claim_index: number; sources: DebateSource[] }
  | ({ event: "debate"; claim_index: number; claim_verdict?: Verdict } & DebateEvent)
  | { event: "done"; result: unknown }
  | { event: "error"; detail?: string }
  /** Keep-alive the server sends while a slow step (search, a rate-limit wait) runs. */
  | { event: "ping" };

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
  /** Claim currently being debated (MADAM-RAG), 0-based */
  debatingClaim?: number;
  debateRound?: number;
}
