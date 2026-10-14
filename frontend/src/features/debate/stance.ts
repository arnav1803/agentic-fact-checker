import type { AgentTurn, Aggregation, VerdictKind } from "@/lib/types";

/**
 * Debates come in two flavours:
 *  - "verdict": fact-checking a claim; each agent rules SUPPORTS / REFUTES / NOT_ENOUGH_INFO
 *  - "qa":      the paper's RAMDocs setup; each agent gives a free-text answer
 * A stance is how a seat is coloured: by verdict, or by which answer it backs.
 */
export type DebateMode = "verdict" | "qa";

export interface Stance {
  key: string;
  label: string;
  color: string;
}

/** How the aggregator treated a seat after its latest ruling. */
export type SeatJudgement = "accepted" | "rejected" | "irrelevant" | "pending";

const VERDICT_STANCE: Record<VerdictKind, Stance> = {
  SUPPORTS: { key: "SUPPORTS", label: "Supports", color: "var(--verdict-supports)" },
  REFUTES: { key: "REFUTES", label: "Refutes", color: "var(--verdict-refutes)" },
  NOT_ENOUGH_INFO: {
    key: "NOT_ENOUGH_INFO",
    label: "Not enough info",
    color: "var(--verdict-insufficient)",
  },
};

const UNKNOWN_STANCE: Stance = {
  key: "unknown",
  label: "No answer in document",
  color: "var(--muted-foreground)",
};

const PALETTE_SIZE = 6;

// Mirrors normalize_answer in the backend (madam_rag.py)
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-") // e.g. "mezzo-soprano" written with U+2011
    .toLowerCase()
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .replace(/\b(a|an|the)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const UNKNOWN_RE =
  /^(unknown|none|n ?a|not (mentioned|stated|specified|provided|available|given)|no (answer|information|info)|the document does not|document does not|cannot be determined|not enough info)/;

export function isUnknownAnswer(answer: string): boolean {
  const n = normalizeAnswer(answer);
  return !n || UNKNOWN_RE.test(n);
}

function containsWords(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

/** Same rule as the backend metric: whole-word containment either way. */
export function sameAnswer(a: string, b: string): boolean {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  if (!x || !y) return false;
  return x === y || containsWords(x, y) || containsWords(y, x);
}

/**
 * Groups equivalent answers ("1963", "1963." and "born in 1963") so agents
 * backing the same answer share a colour. Clusters are numbered in order of
 * first appearance, which keeps colours stable as a debate unfolds.
 */
export class AnswerClusters {
  private clusters: { label: string; members: string[] }[] = [];

  constructor(answers: string[]) {
    for (const a of answers) this.idOf(a);
  }

  idOf(answer: string): number {
    if (isUnknownAnswer(answer)) return -1;
    const found = this.clusters.findIndex((c) => c.members.some((m) => sameAnswer(m, answer)));
    if (found >= 0) {
      if (!this.clusters[found].members.includes(answer)) this.clusters[found].members.push(answer);
      return found;
    }
    this.clusters.push({ label: answer, members: [answer] });
    return this.clusters.length - 1;
  }

  stance(answer: string): Stance {
    const id = this.idOf(answer);
    if (id < 0) return UNKNOWN_STANCE;
    const c = this.clusters[id];
    return {
      key: `a${id}`,
      label: c.label,
      color: `var(--stance-${(id % PALETTE_SIZE) + 1})`,
    };
  }

  get all(): Stance[] {
    return this.clusters.map((c) => this.stance(c.label));
  }
}

export function stanceOf(
  turn: AgentTurn | undefined,
  mode: DebateMode,
  clusters: AnswerClusters,
): Stance | null {
  if (!turn) return null;
  if (mode === "verdict") return VERDICT_STANCE[turn.verdict ?? "NOT_ENOUGH_INFO"];
  return clusters.stance(turn.answer);
}

export function verdictStance(v: VerdictKind): Stance {
  return VERDICT_STANCE[v];
}

/** Build clusters from every answer seen so far, aggregator answers first. */
export function clustersFor(rounds: (AgentTurn | undefined)[][], aggregations: Aggregation[]) {
  const answers: string[] = [];
  for (const a of aggregations) answers.push(...a.answers);
  for (const r of rounds) for (const t of r) if (t) answers.push(t.answer);
  return new AnswerClusters(answers);
}

export function judgeSeat(
  agent: number,
  turn: AgentTurn | undefined,
  aggregation: Aggregation | null,
  mode: DebateMode,
): SeatJudgement {
  if (!aggregation || !turn || aggregation.rejected) return "pending";
  if (mode === "verdict") {
    if (aggregation.unreliable_agents?.includes(agent)) return "rejected";
    if (aggregation.irrelevant_agents?.includes(agent)) return "irrelevant";
    if (aggregation.reliable_agents?.includes(agent)) return "accepted";
    return turn.verdict === "NOT_ENOUGH_INFO" ? "irrelevant" : "pending";
  }
  if (isUnknownAnswer(turn.answer)) return "irrelevant";
  return aggregation.answers.some((a) => sameAnswer(a, turn.answer)) ? "accepted" : "rejected";
}
