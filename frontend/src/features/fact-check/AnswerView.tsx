import { ExternalLink, Globe, MessageSquareText } from "lucide-react";
import type { FactCheckResult } from "@/lib/types";
import { Markdown } from "./Markdown";
import { ReportActions } from "./ReportActions";

/** "https://www.thehindu.com/news/national/..." -> "thehindu.com/news/national/..." */
function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const short = u.hostname.replace(/^www\./, "") + path;
    return short.length > 70 ? `${short.slice(0, 70)}…` : short;
  } catch {
    return url;
  }
}

/** Result view for questions: a cited answer from live web sources. */
export function AnswerView({ result }: { result: FactCheckResult }) {
  const sources = result.sources ?? [];

  return (
    <section className="space-y-6" aria-live="polite">
      <div className="glass-card border-l-4 border-l-primary p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquareText className="size-4" />
          Answer
        </div>
        {result.article_text ? (
          <h2 className="text-lg font-semibold text-foreground">{result.article_text}</h2>
        ) : null}
        <Markdown>
          {result.answer || "No answer could be generated from the sources found."}
        </Markdown>
        <ReportActions result={result} />
      </div>

      {sources.length > 0 ? (
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Globe className="size-4" />
            Sources
          </div>
          <ol className="space-y-2">
            {sources.map((url, i) => (
              <li key={url} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                  [{i + 1}]
                </span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 break-all text-primary hover:underline"
                >
                  {shortUrl(url)}
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Answered from live web sources, so double-check anything important. To get a true/false
        verdict instead, paste a statement or an article.
      </p>

      <footer className="glass-card px-4 py-3 text-xs text-muted-foreground">
        Model: {result.model ?? "unknown"} • Duration: {result.duration_seconds}s •{" "}
        {result._id ? `Saved to DB: ${result._id}` : "Not saved"}
      </footer>
    </section>
  );
}
