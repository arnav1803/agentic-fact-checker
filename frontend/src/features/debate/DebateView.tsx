import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { DebateSource } from "@/lib/types";
import { safeExternalUrl } from "@/features/fact-check/verdict";
import { DebateArena } from "./DebateArena";
import { StanceMatrix } from "./StanceMatrix";
import { AgentBadge, StanceShift, StanceTag } from "./StanceShift";
import type { DebateState, FeedItem } from "./state";
import {
  clustersFor,
  judgeSeat,
  stanceOf,
  verdictStance,
  type AnswerClusters,
  type DebateMode,
} from "./stance";

interface Props {
  state: DebateState;
  sources: DebateSource[];
  mode: DebateMode;
  /** The claim (verdict mode) or question (qa mode) under debate */
  subject: string;
  revealTruth?: boolean;
  /** Extra controls in the header, e.g. replay buttons */
  actions?: ReactNode;
}

export function DebateView({ state, sources, mode, subject, revealTruth, actions }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const clusters = useMemo(
    () => clustersFor(state.rounds, state.aggregations),
    [state.rounds, state.aggregations],
  );

  return (
    <div className="@container space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[68ch] text-sm leading-relaxed text-foreground">{subject}</p>
        <div className="flex items-center gap-2">
          <StatusPill state={state} />
          {actions}
        </div>
      </div>

      {state.status === "done" && mode === "verdict" ? <StanceShift state={state} /> : null}

      {/* Table and transcript side by side only when the view itself is wide enough
          for the table to stay legible (a container query, not the screen width) */}
      <div className="grid gap-5 @5xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-center">
          <DebateArena
            state={state}
            sources={sources}
            mode={mode}
            clusters={clusters}
            selected={selected}
            onSelect={setSelected}
            revealTruth={revealTruth}
          />
          <Legend mode={mode} clusters={clusters} />
        </div>
        <div className="min-h-[320px] rounded-lg border border-border bg-background/40">
          {selected !== null ? (
            <AgentInspector
              agent={selected}
              state={state}
              source={sources[selected]}
              mode={mode}
              clusters={clusters}
              revealTruth={revealTruth}
              onBack={() => setSelected(null)}
            />
          ) : (
            <DebateFeed state={state} sources={sources} mode={mode} clusters={clusters} />
          )}
        </div>
      </div>

      {state.rounds.length > 0 ? (
        <StanceMatrix
          state={state}
          sources={sources}
          mode={mode}
          clusters={clusters}
          selected={selected}
          onSelect={setSelected}
        />
      ) : null}

      {state.final && state.status === "done" ? (
        <AggregatorReasoning state={state} mode={mode} clusters={clusters} />
      ) : null}
    </div>
  );
}

function StatusPill({ state }: { state: DebateState }) {
  const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs";
  const grouped = state.strategy === "grouped";
  if (state.status === "running")
    return (
      <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        {grouped
          ? state.aggregating
            ? "Aggregator ruling"
            : state.round >= 2
              ? "Groups arguing"
              : "Reading sources"
          : `Round ${state.round} of ${state.maxRounds}`}
      </span>
    );
  if (state.status === "failed")
    return <span className={`${base} border-destructive/30 text-destructive`}>Debate failed</span>;
  if (state.status === "done" && grouped)
    return (
      <span className={`${base} border-border text-muted-foreground`}>
        {state.campTurns.length ? "Groups argued it out" : "No dispute between sources"}
      </span>
    );
  if (state.status === "done")
    return (
      <span className={`${base} border-border text-muted-foreground`}>
        {state.convergedRound
          ? `Settled in round ${state.convergedRound}`
          : `Ended after ${state.rounds.length} ${state.rounds.length === 1 ? "round" : "rounds"}`}
      </span>
    );
  return <span className={`${base} border-border text-muted-foreground`}>Waiting</span>;
}

function Legend({ mode, clusters }: { mode: DebateMode; clusters: AnswerClusters }) {
  const stances =
    mode === "verdict"
      ? (["SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO"] as const).map(verdictStance)
      : clusters.all.slice(0, 6);
  return (
    <div className="mt-1 flex max-w-[580px] flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {stances.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          <span className="max-w-[140px] truncate">{s.label}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke="var(--verdict-refutes)"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        </svg>
        flagged by aggregator
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="1 4"
          />
        </svg>
        ignored
      </span>
    </div>
  );
}

// ---------- Transcript ----------

function DebateFeed({
  state,
  sources,
  mode,
  clusters,
}: {
  state: DebateState;
  sources: DebateSource[];
  mode: DebateMode;
  clusters: AnswerClusters;
}) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.feed.length]);

  return (
    <div className="flex h-full max-h-[460px] flex-col">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
        <h4 className="text-xs font-semibold text-foreground">Transcript</h4>
        <span className="text-[11px] text-muted-foreground">Select a seat to read its source</span>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {state.feed.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The debate starts once sources are in. Each source gets its own agent.
          </p>
        ) : null}
        <AnimatePresence initial={false}>
          {state.feed.map((item, k) => (
            <motion.div
              key={k}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <FeedLine
                item={item}
                sources={sources}
                mode={mode}
                clusters={clusters}
                grouped={state.strategy === "grouped"}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {state.aggregating ? (
          <p className="text-xs text-primary">Aggregator is weighing round {state.round}…</p>
        ) : null}
      </div>
    </div>
  );
}

function FeedLine({
  item,
  sources,
  mode,
  clusters,
  grouped,
}: {
  item: FeedItem;
  sources: DebateSource[];
  mode: DebateMode;
  clusters: AnswerClusters;
  grouped: boolean;
}) {
  switch (item.kind) {
    case "round":
      if (grouped)
        return (
          <p className="pt-1 text-[11px] font-medium text-muted-foreground">
            {item.round === 1
              ? "Each agent reads only its own source"
              : "Each group's advocate argues against the other group"}
          </p>
        );
      return (
        <p className="pt-1 text-[11px] font-medium text-muted-foreground">
          {item.round === 1
            ? "Round 1: each agent reads only its own source"
            : `Round ${item.round}: agents see each other's answers and may revise`}
        </p>
      );
    case "answer": {
      if (grouped && item.round > 1) return null;
      const s =
        mode === "verdict"
          ? verdictStance((item.verdict as never) ?? "NOT_ENOUGH_INFO")
          : clusters.stance(item.answer);
      return (
        <div className="flex gap-2.5 text-xs leading-relaxed">
          <AgentBadge agent={item.agent} stance={s} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                {sources[item.agent]?.domain ??
                  sources[item.agent]?.title ??
                  `Document ${item.agent + 1}`}
              </span>
              {item.changed ? (
                <span className="shrink-0 text-primary">
                  changed{item.previous ? ` from “${item.previous}”` : ""}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-foreground">
              {mode === "verdict" ? (
                <>
                  <StanceTag stance={s} />{" "}
                </>
              ) : null}
              {item.answer}
            </p>
          </div>
        </div>
      );
    }
    case "aggregation": {
      const a = item.aggregation;
      if (a.rejected) {
        return (
          <div className="rounded-md border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive">
            Aggregator, round {item.round}: its ruling couldn't be used ({a.rejected}). The verdict
            falls back to a majority of the agents.
          </div>
        );
      }
      if (mode === "verdict" && a.verdict) {
        const s = verdictStance(a.verdict);
        const flagged = a.unreliable_agents ?? [];
        return (
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">
            <span className="font-semibold">Aggregator, round {item.round}: </span>
            <span style={{ color: s.color }} className="font-semibold">
              {s.label}
            </span>
            {a.confidence !== undefined ? (
              <span className="text-muted-foreground"> ({Math.round(a.confidence * 100)}%)</span>
            ) : null}
            {flagged.length ? (
              <span className="block text-verdict-refutes">
                Flagged {flagged.map((i) => `A${i + 1}`).join(", ")} as unreliable
              </span>
            ) : null}
          </div>
        );
      }
      return (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">
          <span className="font-semibold">Aggregator, round {item.round}: </span>
          {a.answers.length ? (
            a.answers.map((ans, i) => (
              <span
                key={ans}
                style={{ color: clusters.stance(ans).color }}
                className="font-semibold"
              >
                {i > 0 ? ", " : ""}
                {ans}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">unknown</span>
          )}
        </div>
      );
    }
    case "camps": {
      const [a, b] = item.camps;
      const names = (members: number[]) => members.map((m) => `A${m + 1}`).join(", ");
      return (
        <div className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-relaxed text-foreground">
          {item.camps.length === 2 && a && b ? (
            <>
              The sources split.{" "}
              <span style={{ color: verdictStance(a.stance).color }} className="font-semibold">
                {names(a.members)} {a.stance === "SUPPORTS" ? "support" : "refute"}
              </span>{" "}
              the claim and{" "}
              <span style={{ color: verdictStance(b.stance).color }} className="font-semibold">
                {names(b.members)} {b.stance === "SUPPORTS" ? "support" : "refute"}
              </span>{" "}
              it, so each group argues its case.
            </>
          ) : a ? (
            <>
              <span style={{ color: verdictStance(a.stance).color }} className="font-semibold">
                {names(a.members)} all {a.stance === "SUPPORTS" ? "support" : "refute"}
              </span>{" "}
              the claim. There is nothing to argue, so the aggregator rules next.
            </>
          ) : (
            "No source addressed the claim."
          )}
          {item.setAside.length ? (
            <span className="block text-muted-foreground">
              {names(item.setAside)} had nothing on the claim and sit out.
            </span>
          ) : null}
        </div>
      );
    }
    case "camp": {
      const t = item.turn;
      const was = verdictStance(t.stance);
      const now = verdictStance(t.verdict);
      return (
        <div
          className="rounded-md border-l-2 py-1.5 pl-3 text-xs leading-relaxed"
          style={{ borderColor: was.color }}
        >
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <StanceTag stance={was} />
            <span>group</span>
            {t.conceded ? (
              <span className="font-medium text-primary">
                conceded, now {now.label.toLowerCase()}
              </span>
            ) : (
              <span>held its position</span>
            )}
          </p>
          <p className="mt-1 text-foreground">{t.answer}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t.explanation}</p>
        </div>
      );
    }
    case "converged":
      return (
        <p className="text-xs text-muted-foreground">
          No agent changed its answer in round {item.round}, so the debate stops and round{" "}
          {item.round - 1}'s ruling stands.
        </p>
      );
    case "failed":
      return <p className="text-xs text-destructive">The debate failed: {item.detail}</p>;
  }
}

// ---------- Agent inspector ----------

function AgentInspector({
  agent,
  state,
  source,
  mode,
  clusters,
  revealTruth,
  onBack,
}: {
  agent: number;
  state: DebateState;
  source?: DebateSource;
  mode: DebateMode;
  clusters: AnswerClusters;
  revealTruth?: boolean;
  onBack: () => void;
}) {
  const href = source?.url ? safeExternalUrl(source.url) : null;
  const final = state.final;
  const judged = final ? state.rounds[final.round - 1]?.[agent] : undefined;
  const ruling = judgeSeat(agent, judged, final, mode);
  const rulingText = {
    accepted: "The aggregator relied on this agent.",
    rejected: "The aggregator flagged this agent's answer.",
    irrelevant: "The aggregator found nothing useful here.",
    pending: null,
  }[ruling];

  return (
    <div className="flex h-full max-h-[460px] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Transcript
        </button>
        <h4 className="ml-auto text-xs font-semibold">Agent {agent + 1}</h4>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        <div>
          {source?.title ? <p className="font-medium text-foreground">{source.title}</p> : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-primary hover:underline"
            >
              {source?.domain ?? href} <ExternalLink className="size-3" />
            </a>
          ) : null}
          {revealTruth && source?.type ? (
            <p className="mt-1 text-muted-foreground">
              Answer key:{" "}
              <span
                className={
                  source.type === "misinfo"
                    ? "font-semibold text-verdict-refutes"
                    : source.type === "correct"
                      ? "font-semibold text-verdict-supports"
                      : "font-semibold"
                }
              >
                {source.type === "misinfo"
                  ? "misinformation"
                  : source.type === "correct"
                    ? "correct document"
                    : "noise"}
              </span>
              {source.answer && source.answer !== "unknown" ? ` (says “${source.answer}”)` : null}
            </p>
          ) : null}
          {source?.also?.length ? (
            <p className="mt-1 text-muted-foreground">
              The same report also ran on {source.also.map((a) => a.domain).join(", ")}, so it
              counts as one source.
            </p>
          ) : null}
          <blockquote className="mt-2 max-h-40 overflow-y-auto border-l-2 border-border pl-3 leading-relaxed text-muted-foreground">
            {source?.text ?? "No document text."}
          </blockquote>
        </div>

        {state.rounds.map((round, r) => {
          const t = round[agent];
          if (!t) return null;
          const s = stanceOf(t, mode, clusters);
          return (
            <div key={r}>
              <p className="text-[11px] font-medium text-muted-foreground">
                Round {r + 1}
                {t.changed ? <span className="text-primary"> · changed its answer</span> : null}
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {mode === "verdict" && s ? (
                  <>
                    <StanceTag stance={s} />{" "}
                  </>
                ) : (
                  <span style={{ color: s?.color }}>{t.answer}</span>
                )}
                {mode === "verdict" ? t.answer : null}
              </p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{t.explanation}</p>
            </div>
          );
        })}

        {rulingText && state.status === "done" ? (
          <p
            className={
              ruling === "rejected"
                ? "font-medium text-verdict-refutes"
                : ruling === "accepted"
                  ? "font-medium text-verdict-supports"
                  : "text-muted-foreground"
            }
          >
            {rulingText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Aggregator reasoning ----------

function AggregatorReasoning({
  state,
  mode,
  clusters,
}: {
  state: DebateState;
  mode: DebateMode;
  clusters: AnswerClusters;
}) {
  const f = state.final!;
  const earlier = state.aggregations.filter((a) => a.round !== f.round);
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <h4 className="text-xs font-semibold text-foreground">
        Aggregator's reasoning{" "}
        <span className="font-normal text-muted-foreground">(round {f.round})</span>
      </h4>
      {mode === "qa" ? (
        <p className="mt-2 text-sm">
          {f.answers.length ? (
            f.answers.map((a, i) => (
              <span key={a} className="font-semibold" style={{ color: clusters.stance(a).color }}>
                {i > 0 ? ", " : ""}
                {a}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">unknown</span>
          )}
        </p>
      ) : null}
      {f.ambiguity ? (
        <p className="mt-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-foreground">
          <span className="font-semibold">Ambiguity: </span>
          {f.ambiguity}
        </p>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{f.explanation}</p>
      {earlier.length ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Earlier rounds
          </summary>
          {earlier.map((a) => (
            <p key={a.round} className="mt-2 leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Round {a.round}: </span>
              {mode === "verdict" && a.verdict
                ? `${verdictStance(a.verdict).label}. `
                : `${a.answers.join(", ") || "unknown"}. `}
              {a.explanation}
            </p>
          ))}
        </details>
      ) : null}
    </div>
  );
}
