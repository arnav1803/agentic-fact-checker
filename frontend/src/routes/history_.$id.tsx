import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getFactCheck } from "@/lib/api";
import { ResultView } from "@/features/fact-check/ResultView";

export const Route = createFileRoute("/history_/$id")({
  head: () => ({
    meta: [
      { title: "Fact-check result — FactCheck AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HistoryDetailPage,
  errorComponent: HistoryDetailError,
  notFoundComponent: () => (
    <div className="glass-card p-8 text-center">
      <p className="text-sm">This fact-check result could not be found.</p>
      <Link
        to="/history"
        className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Back to history
      </Link>
    </div>
  ),
});

function HistoryDetailError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <div className="glass-card p-8 text-center">
      <p className="text-sm">We couldn't load this fact-check.</p>
      <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      <button
        onClick={() => {
          router.invalidate();
          reset();
        }}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

function HistoryDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fact-check", id],
    queryFn: ({ signal }) => getFactCheck(id, signal),
  });

  return (
    <div className="space-y-6">
      <Link
        to="/history"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All history
      </Link>

      {isLoading ? (
        <div className="space-y-4">
          <div className="glass-card h-40 animate-pulse" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="glass-card h-40 animate-pulse" />
            <div className="glass-card h-40 animate-pulse" />
          </div>
        </div>
      ) : error ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm">We couldn't load this fact-check.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          {data.article_text ? (
            <section className="glass-card p-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Original article
              </h2>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {data.article_text}
              </p>
            </section>
          ) : null}
          <ResultView result={data} />
        </>
      ) : null}
    </div>
  );
}
