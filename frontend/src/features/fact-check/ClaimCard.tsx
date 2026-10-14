import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Users } from "lucide-react";
import type { ClaimDebate, Verdict } from "@/lib/types";
import { renderJustification, verdictColor, verdictLabel } from "./verdict";

interface Props {
  verdict: Verdict;
  index: number;
  /** MADAM-RAG debate behind this verdict, if it was verified that way */
  debate?: ClaimDebate;
  /** Open this claim's debate in the results page's debates section */
  onShowDebate?: () => void;
}

function ClaimCardImpl({ verdict, index, debate, onShowDebate }: Props) {
  const prefersReduced = useReducedMotion();
  const c = verdictColor(verdict.verdict);
  const pct = Math.round(verdict.confidence * 100);
  const parts = renderJustification(verdict.justification);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReduced ? 0 : 0.35,
        delay: prefersReduced ? 0 : index * 0.07,
      }}
      className="glass-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-foreground">{verdict.claim}</p>
        <span
          className={`shrink-0 rounded-sm px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${c.bg} ${c.text} border-current/20`}
        >
          {verdictLabel(verdict.verdict)}
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>Confidence</span>
          <span className={`font-semibold tabular-nums ${c.text}`}>{pct}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <motion.div
            className={`h-full ${c.bar}`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: prefersReduced ? 0 : 0.6 }}
          />
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {parts.map((p, i) =>
          p.kind === "link" ? (
            <a
              key={i}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {p.value}
            </a>
          ) : (
            <span key={i}>{p.value}</span>
          ),
        )}
      </p>

      {debate ? <DebateSummary debate={debate} onOpen={onShowDebate} /> : null}
    </motion.article>
  );
}

function DebateSummary({ debate, onOpen }: { debate: ClaimDebate; onOpen?: () => void }) {
  const r = debate.record;
  const flagged = (r?.final?.unreliable_agents ?? [])
    .map((i) => debate.sources[i]?.domain)
    .filter(Boolean);
  const changed = r ? r.rounds.flat().filter((t) => t.changed).length : 0;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
      <span className="text-muted-foreground">
        {r
          ? `${debate.sources.length} agents, ${r.rounds_used} ${r.rounds_used === 1 ? "round" : "rounds"}` +
            (changed ? `, ${changed} changed their minds` : "")
          : "No sources to debate"}
        {flagged.length ? (
          <span className="text-verdict-refutes"> · flagged {flagged.join(", ")}</span>
        ) : null}
      </span>
      {r && onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Users className="size-3.5" /> See the debate
        </button>
      ) : null}
    </div>
  );
}

export const ClaimCard = memo(ClaimCardImpl);
