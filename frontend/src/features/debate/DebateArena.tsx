import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { DebateCamp, DebateSource } from "@/lib/types";
import { latestTurns, type DebateState } from "./state";
import {
  judgeSeat,
  stanceOf,
  verdictStance,
  type AnswerClusters,
  type DebateMode,
  type SeatJudgement,
} from "./stance";

const SIZE = 460;
const C = SIZE / 2;
const SEAT_ORBIT = 168;
const TABLE_R = 128;
const MOD_R = 56;

interface Props {
  state: DebateState;
  sources: DebateSource[];
  mode: DebateMode;
  clusters: AnswerClusters;
  selected: number | null;
  onSelect: (agent: number | null) => void;
  /** Lab only: badge each seat with its RAMDocs document type */
  revealTruth?: boolean;
}

function seatRadius(n: number) {
  if (n <= 5) return 26;
  if (n <= 8) return 22;
  return 18;
}

function polar(angle: number, r: number) {
  return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle) };
}

/**
 * Where a seat's label goes: beside the seat, on the outside, for seats on the
 * left and right (so a column of seats doesn't stack labels into the next
 * seat), and centred above or below for seats at the top and bottom.
 */
function labelPlacement(angle: number, sr: number) {
  const cos = Math.cos(angle);
  if (cos > 0.45) return { x: sr + 9, y: 4, anchor: "start" as const };
  if (cos < -0.45) return { x: -(sr + 9), y: 4, anchor: "end" as const };
  return Math.sin(angle) < 0
    ? { x: 0, y: -sr - 26, anchor: "middle" as const }
    : { x: 0, y: sr + 18, anchor: "middle" as const };
}

function ringAngles(n: number): number[] {
  return Array.from({ length: n }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1));
}

/**
 * Grouped debates: the groups take sides of the table. Supports sit on the
 * left, Refutes on the right, sources with nothing to say at the bottom.
 */
function groupedAngles(n: number, camps: DebateCamp[], setAside: number[]): number[] {
  const angles = ringAngles(n);
  const place = (members: number[], center: number) => {
    const step = Math.min(0.62, 2.0 / Math.max(members.length, 1));
    members.forEach((m, j) => {
      angles[m] = center + (j - (members.length - 1) / 2) * step;
    });
  };
  for (const c of camps) place(c.members, c.stance === "SUPPORTS" ? Math.PI : 0);
  place(setAside, Math.PI / 2);
  return angles;
}

const SEAT_SPRING = { type: "spring", stiffness: 90, damping: 16 } as const;

/** Below this rendered width, seat labels would be too small to read. */
const COMPACT_BELOW_PX = 480;

function useRenderedWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function truncate(s: string, n: number) {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function mix(color: string, pct: number) {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`;
}

const TRUTH = {
  correct: { symbol: "✓", color: "var(--verdict-supports)", label: "correct document" },
  misinfo: { symbol: "!", color: "var(--verdict-refutes)", label: "misinformation" },
  noise: { symbol: "~", color: "var(--muted-foreground)", label: "noise" },
} as const;

/**
 * The debate table: the aggregator at the centre, one seat per source agent.
 * Seats take the colour of their current stance; when the aggregator collects
 * a round, spokes draw in and then show its ruling on each seat (solid =
 * relied on, red dashed = flagged, dotted = ignored).
 */
export function DebateArena({
  state,
  sources,
  mode,
  clusters,
  selected,
  onSelect,
  revealTruth,
}: Props) {
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState<number | null>(null);
  // On narrow screens the domain labels are dropped (the transcript and table
  // below name each seat) so the table itself can use the full width.
  const [svgRef, width] = useRenderedWidth<SVGSVGElement>();
  const compact = width > 0 && width < COMPACT_BELOW_PX;
  const marginX = compact ? 30 : 104;
  const n = Math.max(state.numAgents, sources.length);
  const sr = seatRadius(n);
  const turns = latestTurns(state);
  const latestAgg = state.aggregations[state.aggregations.length - 1] ?? null;
  // Rulings refer to the round that was aggregated; once a newer round starts
  // they are kept but dimmed until the aggregator rules again.
  const rulingStale =
    latestAgg !== null && state.round > latestAgg.round && state.status === "running";

  const grouped = state.camps !== null;
  const ruled =
    state.status === "done" && mode === "verdict" && state.final?.verdict
      ? verdictStance(state.final.verdict).color
      : null;
  const angles = state.camps ? groupedAngles(n, state.camps, state.setAside) : ringAngles(n);

  const seats = Array.from({ length: n }, (_, i) => {
    const angle = angles[i];
    const pos = polar(angle, SEAT_ORBIT);
    const turn = turns[i];
    const judgedTurn = latestAgg ? state.rounds[latestAgg.round - 1]?.[i] : undefined;
    const judgement: SeatJudgement = judgeSeat(i, judgedTurn, latestAgg, mode);
    return { i, angle, pos, turn, judgement, stance: stanceOf(turn, mode, clusters) };
  });

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(selected === i ? null : i);
    }
  };

  return (
    <svg
      ref={svgRef}
      // Side margins leave room for the labels beside the left and right seats
      viewBox={`${-marginX} -22 ${SIZE + 2 * marginX} ${SIZE + 64}`}
      className="h-auto w-full max-w-[660px] select-none"
      role="group"
      aria-label={`Debate table with ${n} agents, round ${state.round} of ${state.maxRounds}`}
    >
      <defs>
        <radialGradient id="table-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Table */}
      <circle cx={C} cy={C} r={TABLE_R} fill="url(#table-floor)" />
      <circle cx={C} cy={C} r={TABLE_R} fill="none" stroke="var(--border)" strokeWidth={1.5} />

      {state.camps ? (
        <GroupBands state={state} angles={angles} seatR={sr} reduce={!!reduce} />
      ) : null}

      {/* Spokes: faint at rest, drawn in while aggregating, styled by the ruling after */}
      {seats.map(({ i, angle, stance, judgement, turn }) => {
        const from = polar(angle, SEAT_ORBIT - sr - 4);
        const to = polar(angle, MOD_R + 6);
        const base = (
          <motion.line
            key={`base-${i}`}
            initial={false}
            animate={{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }}
            transition={reduce ? { duration: 0 } : SEAT_SPRING}
            stroke="var(--border)"
            strokeWidth={1}
          />
        );
        let overlay = null;
        if (state.aggregating && turn) {
          overlay = (
            <motion.line
              key={`draw-${i}-${state.round}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={stance?.color}
              strokeWidth={2}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.9 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : i * 0.08 }}
            />
          );
        } else if (judgement !== "pending") {
          const style =
            judgement === "accepted"
              ? { stroke: stance?.color, width: 2.5, dash: undefined, opacity: 1 }
              : judgement === "rejected"
                ? { stroke: "var(--verdict-refutes)", width: 2, dash: "5 5", opacity: 0.95 }
                : {
                    stroke: "var(--muted-foreground)",
                    width: 1.2,
                    dash: "1 5",
                    opacity: 0.7,
                  };
          const mid = polar(angle, (SEAT_ORBIT + MOD_R) / 2);
          overlay = (
            <motion.g
              key={`ruling-${i}-${latestAgg?.round}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: rulingStale ? 0.3 : style.opacity }}
              transition={{ duration: reduce ? 0 : 0.4 }}
            >
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
                strokeLinecap="round"
              />
              {judgement === "rejected" ? (
                <g transform={`translate(${mid.x} ${mid.y})`}>
                  <circle r={8} fill="var(--card)" stroke="var(--verdict-refutes)" />
                  <path
                    d="M-3 -3 L3 3 M3 -3 L-3 3"
                    stroke="var(--verdict-refutes)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </g>
              ) : null}
            </motion.g>
          );
        }
        return (
          <g key={`spoke-${i}`}>
            {base}
            {overlay}
          </g>
        );
      })}

      {/* Evidence travelling to the aggregator */}
      {state.aggregating && !reduce
        ? seats
            .filter((s) => s.turn)
            .map(({ i, angle, stance }) => {
              const from = polar(angle, SEAT_ORBIT - sr - 4);
              const to = polar(angle, MOD_R + 4);
              return (
                <motion.circle
                  key={`pulse-${i}-${state.round}`}
                  r={3.5}
                  fill={stance?.color}
                  initial={{ cx: from.x, cy: from.y, opacity: 0 }}
                  animate={{ cx: [from.x, to.x], cy: [from.y, to.y], opacity: [0, 1, 0] }}
                  transition={{
                    duration: 1.1,
                    delay: 0.4 + i * 0.12,
                    repeat: Infinity,
                    repeatDelay: 0.3,
                    ease: "easeIn",
                  }}
                />
              );
            })
        : null}

      {/* Round progress around the aggregator */}
      <RoundArcs state={state} />

      {/* Aggregator: takes the verdict's colour once it has ruled */}
      <g>
        <circle cx={C} cy={C} r={MOD_R} fill="var(--card)" />
        <circle
          cx={C}
          cy={C}
          r={MOD_R}
          style={{
            fill: ruled ? mix(ruled, 14) : "transparent",
            stroke: ruled ?? (state.status === "done" ? "var(--primary)" : "var(--border)"),
            transition: reduce ? undefined : "fill 0.6s ease, stroke 0.6s ease",
          }}
          strokeWidth={ruled ? 2.5 : 1.5}
        />
        {ruled ? (
          <motion.circle
            cx={C}
            cy={C}
            fill="none"
            stroke={ruled}
            strokeWidth={1}
            initial={{ r: MOD_R, opacity: reduce ? 0.35 : 0.8 }}
            animate={{ r: MOD_R + 7, opacity: 0.35 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }}
          />
        ) : null}
        {state.aggregating && !reduce ? (
          <motion.circle
            cx={C}
            cy={C}
            r={MOD_R + 6}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.5}
            strokeDasharray="4 7"
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          />
        ) : null}
        <foreignObject
          x={C - MOD_R + 4}
          y={C - MOD_R + 4}
          width={2 * MOD_R - 8}
          height={2 * MOD_R - 8}
        >
          <CenterLabel state={state} mode={mode} clusters={clusters} />
        </foreignObject>
      </g>

      {/* Seats */}
      {seats.map(({ i, pos, angle, turn, stance, judgement }) => {
        const thinking = state.thinking.includes(i);
        const flagged = judgement === "rejected" && !rulingStale;
        const fill = stance ? mix(stance.color, 22) : "var(--card)";
        const stroke = flagged ? "var(--verdict-refutes)" : (stance?.color ?? "var(--border)");
        const label = sources[i]?.domain ?? `Doc ${i + 1}`;
        const place = labelPlacement(angle, sr);
        const truth = revealTruth && sources[i]?.type ? TRUTH[sources[i].type!] : null;

        return (
          <g
            key={`seat-${i}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected === i}
            aria-label={`Agent ${i + 1}, ${label}${turn ? `, answered ${turn.answer}` : ""}${
              flagged ? ", flagged by the aggregator" : ""
            }`}
            onClick={() => onSelect(selected === i ? null : i)}
            onKeyDown={(e) => onKey(e, i)}
            onFocus={() => setFocused(i)}
            onBlur={() => setFocused(null)}
            className="cursor-pointer outline-none"
          >
            <motion.g
              initial={false}
              animate={{ x: pos.x, y: pos.y }}
              transition={reduce ? { duration: 0 } : SEAT_SPRING}
            >
              {thinking && !reduce ? (
                <motion.circle
                  cx={0}
                  cy={0}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  initial={{ r: sr, opacity: 0.7 }}
                  animate={{ r: sr + 12, opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                />
              ) : null}
              {selected === i || focused === i ? (
                <circle
                  cx={0}
                  cy={0}
                  r={sr + 6}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                />
              ) : null}
              {/* Colour fades via CSS (framer can't interpolate var()/color-mix());
                framer only pulses the seat when its agent changes its answer. */}
              <motion.circle
                key={`body-${i}-${turn?.round ?? 0}`}
                cx={0}
                cy={0}
                r={sr}
                strokeWidth={2.5}
                strokeDasharray={flagged ? "4 3" : undefined}
                initial={{ scale: 1 }}
                animate={{ scale: turn?.changed && !reduce ? [1, 1.18, 1] : 1 }}
                style={{
                  fill,
                  stroke,
                  transition: reduce ? undefined : "fill 0.45s ease, stroke 0.45s ease",
                }}
                transition={{ duration: reduce ? 0 : 0.5 }}
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                className="fill-foreground text-[14px] font-semibold"
              >
                {thinking ? "…" : `A${i + 1}`}
              </text>

              {turn?.changed ? (
                <g transform={`translate(${sr * 0.75} ${-sr * 0.75})`}>
                  <title>Changed its answer this round</title>
                  <circle r={8} fill="var(--primary)" />
                  <path
                    d="M-3.5 0.5 A3.5 3.5 0 1 0 -1.5 -3"
                    fill="none"
                    stroke="var(--primary-foreground)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  <path
                    d="M-1.8 -5.2 L-1.5 -3 L-3.8 -2.6"
                    fill="none"
                    stroke="var(--primary-foreground)"
                    strokeWidth={1.5}
                  />
                </g>
              ) : null}

              {truth ? (
                <g transform={`translate(${-sr * 0.75} ${-sr * 0.75})`}>
                  <title>Answer key: {truth.label}</title>
                  <circle r={8} fill="var(--card)" stroke={truth.color} strokeWidth={1.5} />
                  <text
                    y={3.5}
                    textAnchor="middle"
                    className="text-[10px] font-bold"
                    fill={truth.color}
                  >
                    {truth.symbol}
                  </text>
                </g>
              ) : null}

              {compact ? null : (
                <text
                  x={place.x}
                  y={place.y}
                  textAnchor={place.anchor}
                  className="fill-muted-foreground text-[13px]"
                >
                  {truncate(label, 17)}
                  {sources[i]?.also?.length ? ` +${sources[i].also!.length}` : ""}
                </text>
              )}
              <AnimatePresence mode="wait">
                {turn && !grouped && !compact ? (
                  <motion.text
                    key={`ans-${i}-${turn.round}-${turn.answer}`}
                    x={place.x}
                    y={place.y + 16}
                    textAnchor={place.anchor}
                    className="text-[14px] font-semibold"
                    fill={stance?.color}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                  >
                    {mode === "verdict" && turn.verdict
                      ? verdictStance(turn.verdict).label
                      : truncate(turn.answer, 18)}
                  </motion.text>
                ) : null}
              </AnimatePresence>
            </motion.g>
          </g>
        );
      })}
    </svg>
  );
}

/** Tinted bands behind each group's seats, labelled with the group's position. */
function GroupBands({
  state,
  angles,
  seatR,
  reduce,
}: {
  state: DebateState;
  angles: number[];
  seatR: number;
  reduce: boolean;
}) {
  const groups = [
    ...(state.camps ?? []).map((c, ci) => ({
      key: c.stance as string,
      members: c.members,
      color: verdictStance(c.stance).color,
      label: verdictStance(c.stance).label,
      speaking: state.campThinking.includes(ci),
      conceded: state.campTurns.find((t) => t.camp === ci)?.conceded ?? false,
    })),
    ...(state.setAside.length
      ? [
          {
            key: "aside",
            members: state.setAside,
            color: "var(--muted-foreground)",
            label: "Nothing on the claim",
            speaking: false,
            conceded: false,
          },
        ]
      : []),
  ];
  return (
    <g aria-hidden>
      {groups.map((g) => {
        const a = g.members.map((m) => angles[m]);
        const pad = 0.3;
        const a0 = Math.min(...a) - pad;
        const a1 = Math.max(...a) + pad;
        const p0 = polar(a0, SEAT_ORBIT);
        const p1 = polar(a1, SEAT_ORBIT);
        // Label outside the band, clear of the spokes: above the upper end of a
        // side group, under the bottom group.
        const bottom = Math.sin((a0 + a1) / 2) > 0.7;
        const top = p0.y < p1.y ? p0 : p1;
        const labelAt = bottom
          ? {
              x: polar((a0 + a1) / 2, SEAT_ORBIT).x,
              y: polar((a0 + a1) / 2, SEAT_ORBIT).y + seatR + 44,
            }
          : { x: top.x, y: top.y - seatR - 22 };
        const status = g.speaking ? "arguing its case" : g.conceded ? "conceded" : "";
        return (
          <motion.g
            key={g.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.6 }}
          >
            <motion.path
              d={`M ${p0.x} ${p0.y} A ${SEAT_ORBIT} ${SEAT_ORBIT} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}`}
              fill="none"
              stroke={g.color}
              strokeWidth={2 * seatR + 20}
              strokeLinecap="round"
              initial={{ strokeOpacity: 0.12 }}
              animate={{ strokeOpacity: g.speaking && !reduce ? [0.1, 0.28, 0.1] : 0.12 }}
              transition={g.speaking ? { duration: 1.4, repeat: Infinity } : { duration: 0.3 }}
            />
            <text
              x={labelAt.x}
              y={labelAt.y}
              textAnchor="middle"
              className="text-[13px] font-semibold"
              fill={g.color}
            >
              {g.key === "aside" ? g.label : `${g.label} (${g.members.length})`}
            </text>
            {status ? (
              <text
                x={labelAt.x}
                y={labelAt.y + 15}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {status}
              </text>
            ) : null}
          </motion.g>
        );
      })}
    </g>
  );
}

function RoundArcs({ state }: { state: DebateState }) {
  const total = Math.max(state.maxRounds, 1);
  const r = MOD_R + 14;
  const gap = total > 1 ? 0.18 : 0;
  return (
    <g aria-hidden>
      {Array.from({ length: total }, (_, k) => {
        const round = k + 1;
        const a0 = -Math.PI / 2 + (2 * Math.PI * k) / total + gap / 2;
        const a1 = -Math.PI / 2 + (2 * Math.PI * (k + 1)) / total - gap / 2;
        const p0 = polar(a0, r);
        const p1 = polar(a1, r);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const done =
          round < state.round || (state.status === "done" && round <= state.rounds.length);
        const current = round === state.round && state.status === "running";
        const skipped = state.status === "done" && round > state.rounds.length;
        return (
          <path
            key={round}
            d={`M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`}
            fill="none"
            strokeLinecap="round"
            strokeWidth={4}
            stroke={done || current ? "var(--primary)" : "var(--border)"}
            strokeOpacity={current ? 0.55 : skipped ? 0.35 : 1}
            strokeDasharray={skipped ? "2 6" : undefined}
          />
        );
      })}
    </g>
  );
}

function CenterLabel({
  state,
  mode,
  clusters,
}: {
  state: DebateState;
  mode: DebateMode;
  clusters: AnswerClusters;
}) {
  const box = "flex h-full w-full flex-col items-center justify-center text-center leading-tight";
  if (state.status === "idle")
    return <div className={`${box} text-[13px] text-muted-foreground`}>Aggregator</div>;
  if (state.status === "failed")
    return <div className={`${box} text-[13px] text-destructive`}>Debate failed</div>;

  if (state.status === "done") {
    const f = state.final;
    if (!f) return <div className={`${box} text-[13px] text-muted-foreground`}>No sources</div>;
    if (mode === "verdict" && f.verdict) {
      const s = verdictStance(f.verdict);
      return (
        <div className={box}>
          <span className="text-[16px] font-bold" style={{ color: s.color }}>
            {s.label}
          </span>
          {f.confidence !== undefined ? (
            <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
              {Math.round(f.confidence * 100)}% sure
            </span>
          ) : null}
        </div>
      );
    }
    return (
      <div className={box}>
        {f.answers.length === 0 ? (
          <span className="text-[14px] font-semibold text-muted-foreground">unknown</span>
        ) : (
          f.answers.slice(0, 3).map((a) => (
            <span
              key={a}
              className="max-w-full truncate text-[15px] font-bold"
              style={{ color: clusters.stance(a).color }}
            >
              {a}
            </span>
          ))
        )}
        {f.answers.length > 3 ? (
          <span className="text-[12px] text-muted-foreground">+{f.answers.length - 3} more</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${box} text-[13px]`}>
      <span className="font-semibold text-foreground">
        {state.aggregating ? "Weighing" : `Round ${state.round}`}
      </span>
      <span className="text-[12px] text-muted-foreground">
        {state.aggregating ? `round ${state.round}` : `of ${state.maxRounds}`}
      </span>
    </div>
  );
}
