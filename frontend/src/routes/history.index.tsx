import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getHistory } from "@/lib/api";
import { relativeTime, scoreBand } from "@/features/fact-check/verdict";

export const Route = createFileRoute("/history/")({
  head: () => ({
    meta: [
      { title: "History — FactCheck AI" },
      {
        name: "description",
        content: "Your past fact-check analyses.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["history"],
    queryFn: ({ signal }) => getHistory(signal),
  });

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your past fact-check analyses.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm">We couldn't load your history.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No fact-checks yet — analyze your first article above.
          </p>
          <Link
            to="/analyze"
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Analyze an article
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((item) => {
            const band = scoreBand(item.credibility_score);
            return (
              <li key={item._id}>
                <Link
                  to="/history/$id"
                  params={{ id: item._id }}
                  className="glass-card block p-5 transition hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="line-clamp-2 text-sm text-foreground">
                      {item.article_text}
                    </p>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${band.color}`}
                    >
                      {Math.round(item.credibility_score * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {relativeTime(item.created_at)}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
