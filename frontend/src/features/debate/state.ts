import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentTurn,
  Aggregation,
  CampTurn,
  DebateCamp,
  DebateEvent,
  DebateRecord,
  DebateStrategy,
} from "@/lib/types";

/** One line in the running transcript beside the table. */
export type FeedItem =
  | { kind: "round"; round: number }
  | {
      kind: "answer";
      round: number;
      agent: number;
      answer: string;
      verdict?: string | null;
      changed: boolean;
      previous?: string;
    }
  | { kind: "aggregation"; round: number; aggregation: Aggregation }
  | { kind: "converged"; round: number }
  | { kind: "camps"; camps: DebateCamp[]; setAside: number[] }
  | { kind: "camp"; turn: CampTurn }
  | { kind: "failed"; detail: string };

export interface DebateState {
  status: "idle" | "running" | "done" | "failed";
  strategy: DebateStrategy;
  /** Grouped debates: Supports/Refutes groups formed after round 1 */
  camps: DebateCamp[] | null;
  setAside: number[];
  /** Groups whose advocate is speaking right now */
  campThinking: number[];
  campTurns: CampTurn[];
  numAgents: number;
  maxRounds: number;
  /** Current round, 1-based; 0 before the debate starts */
  round: number;
  /** Agents waiting on the LLM right now */
  thinking: number[];
  aggregating: boolean;
  /** rounds[r][agent], filled in as answers arrive */
  rounds: (AgentTurn | undefined)[][];
  aggregations: Aggregation[];
  final: Aggregation | null;
  convergedRound: number | null;
  feed: FeedItem[];
  error?: string;
}

export function initialDebateState(numAgents = 0, maxRounds = 2): DebateState {
  return {
    status: "idle",
    strategy: "paper",
    camps: null,
    setAside: [],
    campThinking: [],
    campTurns: [],
    numAgents,
    maxRounds,
    round: 0,
    thinking: [],
    aggregating: false,
    rounds: [],
    aggregations: [],
    final: null,
    convergedRound: null,
    feed: [],
  };
}

export function debateReducer(s: DebateState, ev: DebateEvent): DebateState {
  switch (ev.type) {
    case "debate_start":
      return {
        ...initialDebateState(ev.num_agents, ev.max_rounds),
        status: "running",
        strategy: ev.mode ?? "paper",
      };
    case "round_start":
      return {
        ...s,
        status: "running",
        round: ev.round,
        rounds: [...s.rounds, Array.from({ length: s.numAgents }, () => undefined)],
        feed: [...s.feed, { kind: "round", round: ev.round }],
      };
    case "agent_thinking":
      return s.thinking.includes(ev.agent) ? s : { ...s, thinking: [...s.thinking, ev.agent] };
    case "agent_response": {
      const { type: _t, ...turn } = ev;
      const rounds = s.rounds.map((r) => [...r]);
      while (rounds.length < turn.round) rounds.push(Array.from({ length: s.numAgents }));
      rounds[turn.round - 1][turn.agent] = turn;
      const previous = s.rounds[turn.round - 2]?.[turn.agent]?.answer;
      return {
        ...s,
        rounds,
        thinking: s.thinking.filter((a) => a !== turn.agent),
        feed: [
          ...s.feed,
          {
            kind: "answer",
            round: turn.round,
            agent: turn.agent,
            answer: turn.answer,
            verdict: turn.verdict,
            changed: turn.changed,
            previous,
          },
        ],
      };
    }
    case "camps":
      return {
        ...s,
        camps: ev.camps,
        setAside: ev.set_aside,
        feed: [...s.feed, { kind: "camps", camps: ev.camps, setAside: ev.set_aside }],
      };
    case "camp_thinking":
      return s.campThinking.includes(ev.camp)
        ? s
        : { ...s, campThinking: [...s.campThinking, ev.camp] };
    case "camp_response": {
      const { type: _t, round: _r, ...turn } = ev;
      return {
        ...s,
        campThinking: s.campThinking.filter((c) => c !== turn.camp),
        campTurns: [...s.campTurns, turn],
        feed: [...s.feed, { kind: "camp", turn }],
      };
    }
    case "aggregator_thinking":
      return { ...s, aggregating: true, thinking: [], campThinking: [] };
    case "aggregation":
      return {
        ...s,
        aggregating: false,
        aggregations: [...s.aggregations, ev.aggregation],
        final: ev.aggregation,
        feed: [...s.feed, { kind: "aggregation", round: ev.round, aggregation: ev.aggregation }],
      };
    case "converged":
      return {
        ...s,
        convergedRound: ev.round,
        thinking: [],
        feed: [...s.feed, { kind: "converged", round: ev.round }],
      };
    case "debate_end":
      return {
        ...s,
        status: "done",
        thinking: [],
        aggregating: false,
        final: ev.record.final,
        convergedRound: ev.record.converged_round,
      };
    case "debate_failed":
      return {
        ...s,
        status: "failed",
        thinking: [],
        aggregating: false,
        error: ev.detail,
        feed: [...s.feed, { kind: "failed", detail: ev.detail }],
      };
  }
}

/** Re-create the event stream a finished debate would have produced. */
export function recordToEvents(record: DebateRecord): DebateEvent[] {
  if (record.mode === "grouped") return groupedRecordToEvents(record);
  const events: DebateEvent[] = [
    { type: "debate_start", num_agents: record.num_agents, max_rounds: record.max_rounds },
  ];
  record.rounds.forEach((turns, r) => {
    const round = r + 1;
    events.push({ type: "round_start", round });
    for (const t of turns) {
      events.push({ type: "agent_thinking", round, agent: t.agent });
      events.push({ type: "agent_response", ...t });
    }
    if (record.converged_round === round) {
      events.push({ type: "converged", round });
      return;
    }
    const agg = record.aggregations.find((a) => a.round === round);
    if (agg) {
      events.push({ type: "aggregator_thinking", round });
      events.push({ type: "aggregation", round, aggregation: agg });
    }
  });
  events.push({ type: "debate_end", record });
  return events;
}

function groupedRecordToEvents(record: DebateRecord): DebateEvent[] {
  const events: DebateEvent[] = [
    { type: "debate_start", num_agents: record.num_agents, max_rounds: 2, mode: "grouped" },
  ];
  const [first, second] = record.rounds;
  if (first) {
    events.push({ type: "round_start", round: 1 });
    for (const t of first) {
      events.push({ type: "agent_thinking", round: 1, agent: t.agent });
      events.push({ type: "agent_response", ...t });
    }
    events.push({
      type: "camps",
      round: 1,
      camps: record.camps ?? [],
      set_aside: record.set_aside ?? [],
    });
  }
  if (second) {
    events.push({ type: "round_start", round: 2 });
    for (const turn of record.camp_turns ?? []) {
      events.push({ type: "camp_thinking", round: 2, camp: turn.camp, members: turn.members });
    }
    for (const turn of record.camp_turns ?? []) {
      events.push({ type: "camp_response", round: 2, ...turn });
    }
    for (const t of second) events.push({ type: "agent_response", ...t });
  }
  for (const agg of record.aggregations) {
    events.push({ type: "aggregator_thinking", round: agg.round });
    events.push({ type: "aggregation", round: agg.round, aggregation: agg });
  }
  events.push({ type: "debate_end", record });
  return events;
}

export function stateFromRecord(record: DebateRecord): DebateState {
  return recordToEvents(record).reduce(debateReducer, initialDebateState());
}

/** The most recent answer each agent has given. */
export function latestTurns(s: DebateState): (AgentTurn | undefined)[] {
  return Array.from({ length: s.numAgents }, (_, a) => {
    for (let r = s.rounds.length - 1; r >= 0; r--) {
      const t = s.rounds[r]?.[a];
      if (t) return t;
    }
    return undefined;
  });
}

// ---------- Replay ----------

/** Pause after each event type, in ms at 1x speed. */
const REPLAY_DELAY: Record<DebateEvent["type"], number> = {
  debate_start: 400,
  round_start: 700,
  agent_thinking: 220,
  agent_response: 520,
  aggregator_thinking: 1300,
  aggregation: 1100,
  converged: 900,
  camps: 1400,
  camp_thinking: 300,
  camp_response: 1200,
  debate_end: 0,
  debate_failed: 0,
};

/**
 * Animate a finished debate by feeding its events through the reducer on a
 * timer, so a saved result plays back exactly like the live stream.
 */
export function useDebateReplay(record: DebateRecord | null, { autoPlay = true } = {}) {
  const [state, setState] = useState<DebateState>(() =>
    record ? stateFromRecord(record) : initialDebateState(),
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!record) return;
    stop();
    const events = recordToEvents(record);
    let i = 0;
    let s = initialDebateState();
    setPlaying(true);
    const step = () => {
      const ev = events[i++];
      if (!ev) {
        setPlaying(false);
        return;
      }
      s = debateReducer(s, ev);
      setState(s);
      timer.current = setTimeout(step, REPLAY_DELAY[ev.type] / speedRef.current);
    };
    step();
  }, [record, stop]);

  const skip = useCallback(() => {
    stop();
    if (record) setState(stateFromRecord(record));
  }, [record, stop]);

  useEffect(() => {
    if (record && autoPlay) play();
    else if (record) setState(stateFromRecord(record));
    return stop;
  }, [record, autoPlay, play, stop]);

  return { state, playing, play, skip, speed, setSpeed };
}

// ---------- Results page ----------

const OPEN_KEY = "factcheck.debates-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Whether the debates section is open, remembered per browser (open by default). */
export function useDebatesOpen() {
  const [open, setOpenState] = useState(true);
  useEffect(() => setOpenState(readOpen()), []);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      // Storage blocked: the section still works, it just won't remember
    }
  };
  return [open, setOpen] as const;
}
