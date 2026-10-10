import type { FactCheckResult } from "./types";
import { verdictLabel } from "@/features/fact-check/verdict";

/** Render an answered question as Markdown: question, cited answer, sources. */
function answerToMarkdown(result: FactCheckResult): string {
  const lines = [`# ${result.article_text ?? "Question"}`, ``, result.answer ?? "", ``];
  if (result.sources?.length) {
    lines.push(`## Sources`, ``, ...result.sources.map((url, i) => `${i + 1}. ${url}`), ``);
  }
  lines.push(
    `---`,
    `*Answered by FactCheck AI (${result.model ?? "unknown model"}) in ${result.duration_seconds}s` +
      (result.created_at ? ` on ${result.created_at}` : "") +
      `*`,
  );
  return lines.join("\n");
}

/** Render a fact-check result as a shareable Markdown report. */
export function resultToMarkdown(result: FactCheckResult): string {
  if (result.mode === "answer") return answerToMarkdown(result);
  const pct = Math.round(result.credibility_score * 100);
  const lines: string[] = [
    `# FactCheck AI Report`,
    ``,
    `**Credibility score:** ${pct}%`,
    `**Claims analyzed:** ${result.verdicts.length}`,
    `**Model:** ${result.model ?? "unknown"}`,
    `**Duration:** ${result.duration_seconds}s`,
    result.created_at ? `**Checked:** ${result.created_at}` : ``,
    ``,
  ];

  if (result.overall_verdict) {
    lines.push(`## Overall verdict`, ``, result.overall_verdict, ``);
  }

  lines.push(`## Claims`, ``);
  result.verdicts.forEach((v, i) => {
    lines.push(
      `### ${i + 1}. ${v.claim}`,
      ``,
      `- **Verdict:** ${verdictLabel(v.verdict)}`,
      `- **Confidence:** ${Math.round(v.confidence * 100)}%`,
      `- **Justification:** ${v.justification}`,
      ``,
    );
  });

  if (result.article_text) {
    lines.push(`## Original article`, ``, `> ${result.article_text.split("\n").join("\n> ")}`, ``);
  }

  return lines.filter((l) => l !== null).join("\n");
}

export function downloadFile(name: string, content: string, mime: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
