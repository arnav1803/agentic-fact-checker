import type { FactCheckResult } from "@/lib/types";
import { AnswerView } from "./AnswerView";
import { ClaimCard } from "./ClaimCard";
import { Markdown } from "./Markdown";
import { ReportActions } from "./ReportActions";
import { ScoreRing } from "./ScoreRing";
import { scoreBand } from "./verdict";
import { FileSearch, Scale, ListChecks } from "lucide-react";

interface Props {
  result: FactCheckResult;
}

/** Parse structured LLM verdict into labeled sections */
function parseVerdictSections(text: string) {
  const sections: { title: string; body: string }[] = [];
  // Split on the section headers the LLM produces. Models may decorate them as
  // markdown ("**SUMMARY OF FINDINGS:**", "## Key evidence breakdown"), so the
  // heading/bold markers around the title are consumed along with it.
  const headerPattern =
    /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(OVERALL VERDICT|SUMMARY OF FINDINGS|KEY EVIDENCE BREAKDOWN)[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*:?[ \t]*/gi;
  const parts = text.split(headerPattern);

  // parts alternates: [preamble, header1, body1, header2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i]?.trim().toUpperCase() ?? "";
    const body = parts[i + 1]?.trim() ?? "";
    if (title && body) sections.push({ title, body });
  }

  // If parsing fails (legacy or unstructured verdict), return a single block
  if (sections.length === 0 && text.trim()) {
    sections.push({ title: "AI VERDICT", body: text.trim() });
  }
  return sections;
}

function sectionIcon(title: string) {
  const t = title.toUpperCase();
  if (t.includes("VERDICT")) return <Scale className="size-4" />;
  if (t.includes("SUMMARY") || t.includes("FINDINGS")) return <FileSearch className="size-4" />;
  if (t.includes("EVIDENCE") || t.includes("BREAKDOWN")) return <ListChecks className="size-4" />;
  return <FileSearch className="size-4" />;
}

function sectionAccent(title: string) {
  const t = title.toUpperCase();
  if (t.includes("VERDICT")) return "border-l-primary";
  if (t.includes("SUMMARY") || t.includes("FINDINGS")) return "border-l-blue-400";
  if (t.includes("EVIDENCE") || t.includes("BREAKDOWN")) return "border-l-amber-400";
  return "border-l-muted-foreground";
}

export function ResultView({ result }: Props) {
  if (result.mode === "answer") return <AnswerView result={result} />;

  const band = scoreBand(result.credibility_score);
  const verdictSections = result.overall_verdict
    ? parseVerdictSections(result.overall_verdict)
    : [];

  // When the pipeline decided nothing (all claims NOT_ENOUGH_INFO), the score
  // sits at 50% — but that means "unknown", not "mixed". Show it honestly.
  const overallSection = verdictSections.find((s) => s.title === "OVERALL VERDICT");
  const isUnverified =
    /^[*_\s]*UNVERIFIED/i.test(overallSection?.body ?? "") ||
    (result.verdicts.length > 0 && result.verdicts.every((v) => v.verdict === "NOT_ENOUGH_INFO"));
  const bandLabel = isUnverified
    ? "The claims in this article could not be verified against available sources."
    : band.label;
  const bandColor = isUnverified ? "text-muted-foreground" : band.color;

  return (
    <section className="space-y-6" aria-live="polite">
      <div className="glass-card flex flex-col items-center gap-6 p-8 md:flex-row md:items-center md:gap-10">
        <ScoreRing score={result.credibility_score} />
        <div className="text-center md:text-left">
          <h2 className="text-lg font-semibold">Article Credibility Score</h2>
          <p className={`mt-2 text-sm ${bandColor}`}>{bandLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Based on {result.verdicts.length} extracted{" "}
            {result.verdicts.length === 1 ? "claim" : "claims"} verified against live web sources.
          </p>
          <div className="mt-4 flex justify-center md:justify-start">
            <ReportActions result={result} />
          </div>
        </div>
      </div>

      {/* ── Structured Verdict & Summary of Findings ── */}
      {verdictSections.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            🔍 AI Investigation Summary
          </h3>
          {verdictSections.map((sec, i) => (
            <div
              key={i}
              className={`glass-card border-l-4 ${sectionAccent(sec.title)} p-5 space-y-2`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {sectionIcon(sec.title)}
                {sec.title}
              </div>
              <Markdown>{sec.body}</Markdown>
            </div>
          ))}
        </div>
      )}

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
        Model: {result.model ?? "unknown"} • Duration: {result.duration_seconds}s •{" "}
        {result._id ? `Saved to DB: ${result._id}` : "Not saved"}
      </footer>
    </section>
  );
}
