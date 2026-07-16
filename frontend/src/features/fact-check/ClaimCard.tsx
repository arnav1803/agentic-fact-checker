import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Verdict } from "@/lib/types";
import { renderJustification, verdictColor, verdictLabel } from "./verdict";

interface Props {
  verdict: Verdict;
  index: number;
}

function ClaimCardImpl({ verdict, index }: Props) {
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
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${c.bg} ${c.text} ${c.ring}`}
        >
          {verdictLabel(verdict.verdict)}
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>Confidence</span>
          <span className={`font-medium tabular-nums ${c.text}`}>{pct}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
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

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
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
    </motion.article>
  );
}

export const ClaimCard = memo(ClaimCardImpl);
