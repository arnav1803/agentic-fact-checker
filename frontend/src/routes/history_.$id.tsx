import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { getFactCheck } from "@/lib/api";
import { getLocalResult, saveDraft, useUserKey } from "@/lib/user-store";
import { ResultView } from "@/features/fact-check/ResultView";

export const Route = createFileRoute("/history_/$id")({
  head: () => ({
    meta: [{ title: "Fact-check result — FactCheck AI" }, { name: "robots", content: "noindex" }],
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

function HistoryDetailError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // The router types `error` as unknown: anything can be thrown, not just Error.
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="glass-card p-8 text-center">
      <p className="text-sm">We couldn't load this fact-check.</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
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
  const userKey = useUserKey();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fact-check", userKey, id],
    // Local-first: results are cached per user; fall back to the server copy.
    queryFn: ({ signal }) => getLocalResult(userKey, id) ?? getFactCheck(id, signal),
  });

  const recheck = () => {
    if (!data?.article_text) return;
    saveDraft(userKey, data.article_text);
    toast.info("Article loaded into the analyzer");
    navigate({ to: "/analyze" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/history"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All history
        </Link>
        {data?.article_text ? (
          <button
            onClick={recheck}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <RotateCcw className="size-3.5" /> Re-check this article
          </button>
        ) : null}
      </div>

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
          {data.article_text && data.mode !== "answer" ? (
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
