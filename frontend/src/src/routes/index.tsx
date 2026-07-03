import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, XCircle } from "lucide-react";

import { analyzeArticle } from "@/lib/api";
import type { FactCheckResult } from "@/lib/types";
import { InputForm } from "@/features/fact-check/InputForm";
import {
  ProcessingSteps,
  ResultsSkeleton,
} from "@/features/fact-check/ProcessingSteps";
import { ResultView } from "@/features/fact-check/ResultView";
import { HistorySidebar } from "@/features/fact-check/HistorySidebar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FactCheck AI — Analyze an article" },
      {
        name: "description",
        content:
          "Paste a news article and get a credibility score with per-claim verdicts in seconds.",
      },
    ],
  }),
  component: HomePage,
});

const REQUEST_TIMEOUT_MS = 60_000;

function HomePage() {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<FactCheckResult | null>(null);

  const mutation = useMutation<
    FactCheckResult,
    Error,
    { article: string; maxClaims: number }
  >({
    mutationFn: async ({ article, maxClaims }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timeout = setTimeout(
        () => ctrl.abort(new DOMException("Timeout", "AbortError")),
        REQUEST_TIMEOUT_MS,
      );
      try {
        return await analyzeArticle(
          { article_text: article, max_claims: maxClaims },
          ctrl.signal,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
    retry: 1,
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ["history"] });
      toast.success("Analysis complete");
    },
    onError: (err) => {
      if ((err as Error).name === "AbortError") return;
      const status = (err as Error & { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        setServerError(err.message);
      } else if (err.message.includes("Failed to fetch")) {
        toast.error("Couldn't reach the server. Check your connection and try again.");
      } else {
        toast.error(err.message || "Something went wrong");
      }
    },
  });

  const isLoading = mutation.isPending;

  const cancel = () => {
    abortRef.current?.abort();
    mutation.reset();
  };

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl">
        <div className="mesh-bg" />
        <div className="relative z-10 px-6 py-14 text-center md:py-20">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <ShieldCheck className="size-3.5 text-primary" />
            AI-powered news verification
          </div>
          <h1 className="mx-auto max-w-3xl text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
            Fact-check any article in seconds.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground md:text-base">
            Paste a news article and get a credibility score, per-claim
            verdicts, and cited sources — powered by LLMs and web search.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <InputForm
            loading={isLoading}
            serverError={serverError}
            onSubmit={(article, maxClaims) => {
              setServerError(null);
              setResult(null);
              mutation.mutate({ article, maxClaims });
            }}
          />

          {isLoading ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Analyzing your article</h2>
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground hover:bg-white/10"
                >
                  <XCircle className="size-3.5" /> Cancel
                </button>
              </div>
              <ProcessingSteps />
              <ResultsSkeleton />
            </div>
          ) : mutation.isError &&
            !((mutation.error as Error).name === "AbortError") &&
            !serverError ? (
            <div className="glass-card p-6 text-center">
              <p className="text-sm text-foreground">
                We couldn't complete the analysis.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {mutation.error.message}
              </p>
              <button
                onClick={() => mutation.reset()}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Try again
              </button>
            </div>
          ) : result ? (
            <ResultView result={result} />
          ) : null}
        </div>

        <HistorySidebar />
      </div>
    </div>
  );
}
