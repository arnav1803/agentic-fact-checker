import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, FileText, Scale, Search, Loader2 } from "lucide-react";
import type { AnalysisProgress } from "@/lib/types";

const STEPS = [
  { key: "extract", icon: FileText, label: "Extracting claims..." },
  { key: "search", icon: Search, label: "Searching the web..." },
  { key: "verify", icon: Scale, label: "Verifying claims..." },
  { key: "summarize", icon: BarChart3, label: "Computing credibility..." },
] as const;

const PHASE_INDEX: Record<AnalysisProgress["phase"], number> = {
  extract: 0,
  search: 1,
  verify: 2,
  summarize: 3,
};

interface Props {
  /** Real pipeline progress streamed from the backend; falls back to a timer. */
  progress?: AnalysisProgress | null;
}

export function ProcessingSteps({ progress }: Props) {
  const prefersReduced = useReducedMotion();
  const [fallbackActive, setFallbackActive] = useState(0);

  // Timer-driven fallback only when no real progress is streaming in
  useEffect(() => {
    if (progress) return;
    const t = setInterval(() => {
      setFallbackActive((a) => Math.min(a + 1, STEPS.length - 1));
    }, 700);
    return () => clearInterval(t);
  }, [progress]);

  const active = progress ? PHASE_INDEX[progress.phase] : fallbackActive;

  const searchDetail =
    progress?.phase === "search" && progress.searchTotal
      ? `Claim ${progress.searchCurrent}/${progress.searchTotal}` +
        (progress.claim
          ? ` — “${progress.claim.slice(0, 70)}${progress.claim.length > 70 ? "…" : ""}”`
          : "")
      : null;

  return (
    <ol className="glass-card space-y-3 p-6">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const state = i < active ? "done" : i === active ? "active" : "pending";
        const color =
          state === "done"
            ? "text-verdict-supports border-verdict-supports/40 bg-verdict-supports/10"
            : state === "active"
              ? "text-primary border-primary/50 bg-primary/10"
              : "text-muted-foreground border-white/10 bg-white/5";
        return (
          <motion.li
            key={s.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: prefersReduced ? 0 : 0.25, delay: i * 0.05 }}
            className="flex items-center gap-3"
          >
            <span className={`grid size-9 place-items-center rounded-lg border ${color}`}>
              {state === "active" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={
                  state === "pending" ? "text-sm text-muted-foreground" : "text-sm text-foreground"
                }
              >
                {s.label}
              </span>
              {s.key === "search" && state === "active" && searchDetail ? (
                <span className="block truncate text-xs text-muted-foreground">{searchDetail}</span>
              ) : null}
              {s.key === "extract" && state !== "pending" && progress?.claims?.length ? (
                <span className="block text-xs text-muted-foreground">
                  {progress.claims.length} {progress.claims.length === 1 ? "claim" : "claims"} found
                </span>
              ) : null}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="mt-6 space-y-4">
      <div className="glass-card h-40 animate-pulse" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass-card h-40 animate-pulse" />
        <div className="glass-card h-40 animate-pulse" />
      </div>
    </div>
  );
}
