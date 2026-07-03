import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, FileText, Scale, Search, Loader2 } from "lucide-react";

const STEPS = [
  { icon: FileText, label: "Extracting claims..." },
  { icon: Search, label: "Searching the web..." },
  { icon: Scale, label: "Verifying claims..." },
  { icon: BarChart3, label: "Computing credibility..." },
];

export function ProcessingSteps() {
  const prefersReduced = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setActive((a) => Math.min(a + 1, STEPS.length - 1));
    }, 700);
    return () => clearInterval(t);
  }, []);

  return (
    <ol className="glass-card space-y-3 p-6">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const state =
          i < active ? "done" : i === active ? "active" : "pending";
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
            <span
              className={`grid size-9 place-items-center rounded-lg border ${color}`}
            >
              {state === "active" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
            </span>
            <span
              className={
                state === "pending"
                  ? "text-sm text-muted-foreground"
                  : "text-sm text-foreground"
              }
            >
              {s.label}
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
