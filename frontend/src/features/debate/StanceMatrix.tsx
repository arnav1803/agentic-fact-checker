import type { DebateSource } from "@/lib/types";
import type { DebateState } from "./state";
import {
  judgeSeat,
  stanceOf,
  verdictStance,
  type AnswerClusters,
  type DebateMode,
  type SeatJudgement,
} from "./stance";

const RULING: Record<SeatJudgement, { text: string; className: string }> = {
  accepted: { text: "Relied on", className: "text-verdict-supports" },
  rejected: { text: "Flagged", className: "text-verdict-refutes font-semibold" },
  irrelevant: { text: "Ignored", className: "text-muted-foreground" },
  pending: { text: "—", className: "text-muted-foreground" },
};

/**
 * Every agent's answer in every round, so stubborn agents, converts and the
 * aggregator's final ruling can be read at a glance.
 */
export function StanceMatrix({
  state,
  sources,
  mode,
  clusters,
  selected,
  onSelect,
}: {
  state: DebateState;
  sources: DebateSource[];
  mode: DebateMode;
  clusters: AnswerClusters;
  selected: number | null;
  onSelect: (agent: number | null) => void;
}) {
  const rounds = Math.max(state.rounds.length, 1);
  const finalAgg = state.final;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-separate border-spacing-y-1 text-xs">
        <caption className="sr-only">Answers by agent and round</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="px-2 py-1 font-medium">
              Agent
            </th>
            {Array.from({ length: rounds }, (_, r) => (
              <th key={r} scope="col" className="px-2 py-1 font-medium">
                {state.strategy === "grouped"
                  ? r === 0
                    ? "Own reading"
                    : "After group debate"
                  : `Round ${r + 1}`}
              </th>
            ))}
            <th scope="col" className="px-2 py-1 font-medium">
              Aggregator
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: state.numAgents }, (_, a) => {
            const judgedTurn = finalAgg ? state.rounds[finalAgg.round - 1]?.[a] : undefined;
            const ruling = RULING[judgeSeat(a, judgedTurn, finalAgg, mode)];
            const isSel = selected === a;
            return (
              <tr
                key={a}
                onClick={() => onSelect(isSel ? null : a)}
                className={`cursor-pointer ${isSel ? "bg-primary/10" : "hover:bg-accent/60"}`}
              >
                <th scope="row" className="rounded-l-md px-2 py-1.5 text-left font-medium">
                  <span className="text-foreground">A{a + 1}</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    {sources[a]?.domain ?? `Doc ${a + 1}`}
                  </span>
                </th>
                {Array.from({ length: rounds }, (_, r) => {
                  const t = state.rounds[r]?.[a];
                  const s = stanceOf(t, mode, clusters);
                  const text =
                    mode === "verdict" && t?.verdict ? verdictStance(t.verdict).label : t?.answer;
                  return (
                    <td key={r} className="px-2 py-1.5">
                      {t && s ? (
                        <span className="inline-flex max-w-[200px] items-center gap-1.5">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: s.color }}
                          />
                          <span className="truncate" title={t.answer}>
                            {text}
                          </span>
                          {t.changed ? (
                            <span className="shrink-0 text-primary" title="Changed its answer">
                              ↻
                            </span>
                          ) : null}
                        </span>
                      ) : state.thinking.includes(a) && state.round === r + 1 ? (
                        <span className="text-muted-foreground">thinking…</span>
                      ) : (
                        <span className="text-muted-foreground/50">·</span>
                      )}
                    </td>
                  );
                })}
                <td className={`rounded-r-md px-2 py-1.5 ${ruling.className}`}>{ruling.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
