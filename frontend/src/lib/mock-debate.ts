import type {
  AgentTurn,
  Aggregation,
  CampTurn,
  DebateCamp,
  DebateEvent,
  DebateRecord,
  DebateSource,
  VerdictKind,
} from "./types";
import { recordToEvents } from "@/features/debate/state";

/**
 * Scripted MADAM-RAG claim debates for mock mode (no backend), so the debate UI can
 * be demoed and developed offline. Event order matches madam_rag.run_debate.
 */

function turn(
  agent: number,
  round: number,
  answer: string,
  explanation: string,
  changed = false,
  verdict?: VerdictKind,
): AgentTurn {
  return { agent, round, answer, explanation, changed, verdict: verdict ?? null };
}

export function mockClaimSources(claim: string): DebateSource[] {
  const short = claim.slice(0, 60);
  return [
    {
      agent: 0,
      domain: "reuters.com",
      title: `Report: ${short}`,
      url: "https://reuters.com/mock-1",
      text: `Officials confirmed the details: ${claim}`,
      scraped: true,
      also: [{ domain: "apnews.com", url: "https://apnews.com/mock-1" }],
    },
    {
      agent: 1,
      domain: "dailyviralnews.net",
      title: `SHOCKING: the truth about "${claim.slice(0, 40)}…"`,
      url: "https://dailyviralnews.net/mock-2",
      text: `Insiders say the official figures were invented. ${claim}`,
      scraped: true,
    },
    {
      agent: 2,
      domain: "en.wikipedia.org",
      title: "Background",
      url: "https://en.wikipedia.org/mock-3",
      text: "Background article on the general topic without the specific figures in the claim.",
      scraped: true,
    },
    {
      agent: 3,
      domain: "bbc.com",
      title: `Explainer: ${short}`,
      url: "https://bbc.com/mock-4",
      text: `The figures match the official release. ${claim}`,
      scraped: true,
    },
  ];
}

/**
 * Grouped claim debate, as the backend runs it for news: two independent
 * outlets support, a dubious site refutes and later concedes, one source is
 * off-topic and set aside.
 */
export function mockClaimDebate(claim: string): DebateEvent[] {
  const r1 = [
    turn(
      0,
      1,
      "Officials confirmed the stated details",
      "The wire report quotes the announcement.",
      false,
      "SUPPORTS",
    ),
    turn(
      1,
      1,
      "Claims the figures were invented",
      "The article cites unnamed insiders.",
      false,
      "REFUTES",
    ),
    turn(2, 1, "unknown", "Background only; the claim is not addressed.", false, "NOT_ENOUGH_INFO"),
    turn(
      3,
      1,
      "The figures match the official release",
      "The explainer repeats the official numbers.",
      false,
      "SUPPORTS",
    ),
  ];
  const camps: DebateCamp[] = [
    { stance: "SUPPORTS", members: [0, 3] },
    { stance: "REFUTES", members: [1] },
  ];
  const campTurns: CampTurn[] = [
    {
      camp: 0,
      stance: "SUPPORTS",
      members: [0, 3],
      verdict: "SUPPORTS",
      answer: "Two independent outlets report the official figures",
      explanation:
        "The opposing source relies on unnamed insiders and offers no figures of its own.",
      conceded: false,
    },
    {
      camp: 1,
      stance: "REFUTES",
      members: [1],
      verdict: "SUPPORTS",
      answer: "The official figures stand",
      explanation:
        "Our only source cites anonymous insiders; the other group quotes the announcement itself.",
      conceded: true,
    },
  ];
  const r2 = r1.map((t) => {
    const ct = campTurns.find((c) => c.members.includes(t.agent));
    return ct
      ? {
          ...t,
          round: 2,
          verdict: ct.verdict,
          answer: ct.answer,
          explanation: ct.explanation,
          changed: ct.verdict !== t.verdict,
        }
      : { ...t, round: 2, changed: false };
  });
  const agg: Aggregation = {
    round: 2,
    answers: ["SUPPORTS"],
    verdict: "SUPPORTS",
    confidence: 0.88,
    reliable_agents: [0, 3],
    unreliable_agents: [1],
    irrelevant_agents: [2],
    ambiguity: "",
    explanation:
      "Two independent outlets (one wire story, also carried by apnews.com) report the official figures. The dissenting site cites unnamed insiders and its advocate conceded. The background article does not address the claim.",
  };
  void claim;
  return recordToEvents({
    mode: "grouped",
    num_agents: 4,
    max_rounds: 2,
    rounds_used: 2,
    converged: false,
    converged_round: null,
    camps,
    set_aside: [2],
    camp_turns: campTurns,
    rounds: [r1, r2],
    aggregations: [agg],
    final: agg,
  });
}

export const MOCK_EVENT_DELAY: Record<DebateEvent["type"], number> = {
  debate_start: 200,
  round_start: 350,
  agent_thinking: 90,
  agent_response: 380,
  aggregator_thinking: 1100,
  aggregation: 700,
  converged: 500,
  camps: 1200,
  camp_thinking: 250,
  camp_response: 1100,
  debate_end: 200,
  debate_failed: 0,
};
