import { useState } from "react";
import type { DebateEvent, DebateSource, StreamEvent, Verdict } from "@/lib/types";
import { DebateView } from "./DebateView";
import { debateReducer, initialDebateState, type DebateState } from "./state";
import { verdictStance } from "./stance";

/** Everything the analyzer has heard about each claim's debate so far. */
export interface LiveDebates {
  sources: Record<number, DebateSource[]>;
  debates: Record<number, DebateState>;
  verdicts: Record<number, Verdict>;
  /** Claim being debated right now */
  active: number | null;
}

export const EMPTY_LIVE_DEBATES: LiveDebates = {
  sources: {},
  debates: {},
  verdicts: {},
  active: null,
};

/** Fold one pipeline stream event into the live debate state. */
export function applyStreamEvent(live: LiveDebates, ev: StreamEvent): LiveDebates {
  if (ev.event === "sources") {
    return { ...live, sources: { ...live.sources, [ev.claim_index]: ev.sources } };
  }
  if (ev.event !== "debate") return live;
  const i = ev.claim_index;
  const prev = live.debates[i] ?? initialDebateState(live.sources[i]?.length ?? 0);
  const next = debateReducer(prev, ev as DebateEvent);
  return {
    ...live,
    active: ev.type === "debate_start" ? i : live.active,
    debates: { ...live.debates, [i]: next },
    verdicts: ev.claim_verdict ? { ...live.verdicts, [i]: ev.claim_verdict } : live.verdicts,
  };
}

export function LiveDebatePanel({ claims, live }: { claims: string[]; live: LiveDebates }) {
  // Follow the claim being debated unless the user picks another one.
  const [pinned, setPinned] = useState<number | null>(null);
  const withSources = Object.keys(live.sources).map(Number);
  const shown = pinned ?? live.active ?? (withSources.length ? Math.max(...withSources) : null);

  if (!claims.length) return null;
  const sources = shown !== null ? (live.sources[shown] ?? []) : [];
  const state = shown !== null ? (live.debates[shown] ?? initialDebateState(sources.length)) : null;

  return (
    <section className="glass-card space-y-5 p-5 md:p-6" aria-label="Live agent debate">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Claims">
        {claims.map((c, i) => {
          const d = live.debates[i];
          const v = live.verdicts[i];
          const status = v
            ? verdictStance(v.verdict).label
            : d?.status === "running"
              ? "Debating"
              : live.sources[i]
                ? `${live.sources[i].length} sources, waiting`
                : "Searching";
          const color = v ? verdictStance(v.verdict).color : undefined;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={shown === i}
              onClick={() => setPinned(pinned === i ? null : i)}
              title={c}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                shown === i
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="font-semibold">Claim {i + 1}</span>
              {d?.status === "running" ? (
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              ) : (
                <span
                  className="size-1.5 rounded-full bg-border"
                  style={color ? { background: color } : undefined}
                />
              )}
              <span style={color ? { color } : undefined}>{status}</span>
            </button>
          );
        })}
        {pinned !== null ? (
          <button
            type="button"
            onClick={() => setPinned(null)}
            className="text-xs text-primary hover:underline"
          >
            Follow the live debate
          </button>
        ) : null}
      </div>

      {shown !== null && state ? (
        <DebateView state={state} sources={sources} mode="verdict" subject={claims[shown] ?? ""} />
      ) : (
        <p className="text-sm text-muted-foreground">Finding sources for the first claim…</p>
      )}
    </section>
  );
}
