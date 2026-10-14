import type { AgentTurn, VerdictKind } from "@/lib/types";
import { latestTurns, type DebateState } from "./state";
import { verdictStance, type Stance } from "./stance";

const ORDER: VerdictKind[] = ["SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO"];

function tally(turns: (AgentTurn | undefined)[]) {
  const counts = new Map<VerdictKind, number>();
  for (const t of turns) {
    if (!t) continue;
    const v = t.verdict ?? "NOT_ENOUGH_INFO";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return ORDER.filter((v) => counts.get(v)).map((v) => ({
    stance: verdictStance(v),
    count: counts.get(v)!,
  }));
}

/**
 * How the sources' positions moved: what each agent concluded from its own
 * source, what it held after the debate, and where the aggregator came down.
 */
export function StanceShift({ state }: { state: DebateState }) {
  const first = state.rounds[0] ?? [];
  if (!first.some(Boolean)) return null;
  const before = tally(first);
  const after = tally(latestTurns(state));
  const total = first.filter(Boolean).length;
  const moved = state.rounds.slice(1).some((r) => r.some((t) => t?.changed));
  const final = state.final?.verdict ? verdictStance(state.final.verdict) : null;

  return (
    <div
      className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      role="group"
      aria-label="How the sources' positions changed"
    >
      <div className="space-y-2">
        <ShiftRow label="Own reading" parts={before} total={total} />
        {moved ? (
          <ShiftRow label="After debate" parts={after} total={total} />
        ) : (
          <p className="text-[11px] text-muted-foreground sm:pl-[92px]">
            No source changed its position{state.rounds.length > 1 ? " in the debate" : ""}.
          </p>
        )}
      </div>
      {final ? (
        <div className="flex items-center gap-2 border-t border-border pt-2 text-xs sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <span className="text-muted-foreground">Ruling</span>
          <StanceTag stance={final} />
          {state.final?.confidence !== undefined ? (
            <span className="tabular-nums text-muted-foreground">
              {Math.round(state.final.confidence * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ShiftRow({
  label,
  parts,
  total,
}: {
  label: string;
  parts: { stance: Stance; count: number }[];
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:flex-nowrap">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div
        className="flex h-2.5 min-w-[96px] flex-1 gap-0.5 overflow-hidden rounded-full"
        aria-hidden
      >
        {parts.map((p) => (
          <span
            key={p.stance.key}
            className="h-full transition-[flex-grow] duration-500 first:rounded-l-full last:rounded-r-full"
            style={{ flexGrow: p.count, flexBasis: 0, background: p.stance.color }}
          />
        ))}
      </div>
      <span className="flex shrink-0 gap-2.5 text-foreground">
        {parts.map((p) => (
          <span key={p.stance.key} className="inline-flex items-center gap-1 tabular-nums">
            <span className="size-1.5 rounded-full" style={{ background: p.stance.color }} />
            {p.count}
            <span className="sr-only">
              {" "}
              of {total} {p.stance.label.toLowerCase()}
            </span>
            <span className="text-muted-foreground" aria-hidden>
              {p.stance.key === "NOT_ENOUGH_INFO" ? "no info" : p.stance.label.toLowerCase()}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** A stance as a small tinted tag, so long answers can stay in body text colour. */
export function StanceTag({ stance }: { stance: Stance }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-px align-[1px] text-[10px] font-semibold"
      style={{
        color: stance.color,
        background: `color-mix(in oklch, ${stance.color} 14%, transparent)`,
      }}
    >
      {stance.label}
    </span>
  );
}

/** The seat's badge in the transcript, coloured like the seat on the table. */
export function AgentBadge({ agent, stance }: { agent: number; stance: Stance | null }) {
  return (
    <span
      className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-foreground"
      style={
        stance
          ? {
              borderColor: stance.color,
              background: `color-mix(in oklch, ${stance.color} 20%, transparent)`,
            }
          : { borderColor: "var(--border)" }
      }
    >
      A{agent + 1}
    </span>
  );
}
