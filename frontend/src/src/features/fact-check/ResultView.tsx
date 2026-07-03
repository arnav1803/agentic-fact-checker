import type { FactCheckResult } from "@/lib/types";
import { ClaimCard } from "./ClaimCard";
import { ScoreRing } from "./ScoreRing";
import { scoreBand } from "./verdict";

interface Props {
  result: FactCheckResult;
}

export function ResultView({ result }: Props) {
  const band = scoreBand(result.credibility_score);

  return (
    <section className="space-y-6" aria-live="polite">
      <div className="glass-card flex flex-col items-center gap-6 p-8 md:flex-row md:items-center md:gap-10">
        <ScoreRing score={result.credibility_score} />
        <div className="text-center md:text-left">
          <h2 className="text-lg font-semibold">Article Credibility Score</h2>
          <p className={`mt-2 text-sm ${band.color}`}>{band.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Based on {result.verdicts.length} extracted{" "}
            {result.verdicts.length === 1 ? "claim" : "claims"}.
          </p>
        </div>
      </div>

      {result.verdicts.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          No verifiable claims were found in this article.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {result.verdicts.map((v, i) => (
            <ClaimCard key={`${v.claim}-${i}`} verdict={v} index={i} />
          ))}
        </div>
      )}

      <footer className="glass-card px-4 py-3 text-xs text-muted-foreground">
        Model: {result.model ?? "llama-3.3-70b-versatile"} • Duration:{" "}
        {result.duration_seconds}s •{" "}
        {result._id ? `Saved to DB: ${result._id}` : "Not saved"}
      </footer>
    </section>
  );
}
