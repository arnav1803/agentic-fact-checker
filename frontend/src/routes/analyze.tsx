import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, XCircle, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";

import { analyzeArticleStream } from "@/lib/api";
import { clearDraft, recordResult, useUserKey } from "@/lib/user-store";
import type { AnalysisProgress, FactCheckResult } from "@/lib/types";
import { InputForm, type AnalyzeInput } from "@/features/fact-check/InputForm";
import {
  EMPTY_LIVE_DEBATES,
  LiveDebatePanel,
  applyStreamEvent,
  type LiveDebates,
} from "@/features/debate/LiveDebatePanel";
import { ProcessingSteps, ResultsSkeleton } from "@/features/fact-check/ProcessingSteps";
import { ResultView } from "@/features/fact-check/ResultView";
import { HistorySidebar } from "@/features/fact-check/HistorySidebar";

export const Route = createFileRoute("/analyze")({
  head: () => ({
    meta: [
      { title: "FactCheck AI — Analyze an article" },
      {
        name: "description",
        content:
          "Paste a news article to get a credibility score with per-claim verdicts, or ask a question and get an answer from live web sources.",
      },
    ],
  }),
  component: HomePage,
});

// The stream sends an event per pipeline step; abort only if it goes silent.
const IDLE_TIMEOUT_MS = 90_000;

function HomePage() {
  // Guests are allowed: their checks are saved under the "guest" namespace
  // and migrate naturally once they sign in and re-run analyses.
  const { loading: authLoading } = useAuth();

  const qc = useQueryClient();
  const userKey = useUserKey();
  const abortRef = useRef<AbortController | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [live, setLive] = useState<LiveDebates>(EMPTY_LIVE_DEBATES);
  const [debating, setDebating] = useState(false);

  const mutation = useMutation<FactCheckResult, Error, AnalyzeInput>({
    mutationFn: async ({ article, url, maxClaims, verification, debateRounds }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setProgress(null);
      setLive(EMPTY_LIVE_DEBATES);
      setDebating(verification === "madam");

      // Idle watchdog: each streamed event (the server pings every 15s while a
      // step is busy) resets the clock, so long pipelines are fine but a dead
      // connection still aborts. TimeoutError, unlike a user's cancel
      // (AbortError), is reported to the user.
      const stalled = () =>
        ctrl.abort(
          new DOMException("The server stopped responding. Try again in a minute.", "TimeoutError"),
        );
      let idleTimer = setTimeout(stalled, IDLE_TIMEOUT_MS);
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(stalled, IDLE_TIMEOUT_MS);
      };

      try {
        return await analyzeArticleStream(
          {
            article_text: article,
            url,
            max_claims: maxClaims,
            verification,
            debate_rounds: debateRounds,
          },
          (ev) => {
            resetIdle();
            if (ev.event === "mode") {
              const mode = ev.mode;
              setProgress({ mode, phase: mode === "answer" ? "plan" : "extract" });
            } else if (ev.event === "claims") {
              setProgress((p) => ({ ...p, phase: p?.phase ?? "extract", claims: ev.claims }));
            } else if (ev.event === "queries") {
              setProgress((p) => ({ ...p, phase: p?.phase ?? "plan", queries: ev.queries }));
            } else if (ev.event === "step") {
              setProgress((p) => ({
                ...p,
                phase: ev.step,
                searchCurrent: ev.current,
                searchTotal: ev.total,
                claim: ev.claim,
                query: ev.query,
              }));
            } else if (ev.event === "sources" || ev.event === "debate") {
              setLive((l) => applyStreamEvent(l, ev));
              if (
                ev.event === "debate" &&
                (ev.type === "round_start" || ev.type === "debate_start")
              ) {
                const round = ev.type === "round_start" ? ev.round : 0;
                setProgress((p) =>
                  p ? { ...p, debatingClaim: ev.claim_index, debateRound: round } : p,
                );
              }
            }
          },
          ctrl.signal,
          userKey,
        );
      } finally {
        clearTimeout(idleTimer);
      }
    },
    // One automatic retry for network blips only. Never after the user cancels
    // (a retry would silently restart the whole pipeline), a stall, an error
    // the server reported, or a 4xx response.
    retry: (failureCount, err) => {
      const status = (err as Error & { status?: number }).status;
      return (
        failureCount < 1 &&
        !["AbortError", "TimeoutError", "PipelineError"].includes(err.name) &&
        !(status && status >= 400 && status < 500)
      );
    },
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      recordResult(userKey, data);
      clearDraft(userKey);
      qc.invalidateQueries({ queryKey: ["history"] });
      toast.success(data.mode === "answer" ? "Answer ready" : "Analysis complete");
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

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section className="glass-card p-6 md:p-8 relative overflow-hidden">
        <div className="relative z-10">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <ShieldCheck className="size-3.5" />
            AI-powered news verification
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Fact-check any article in seconds.
          </h1>
          <p className="mt-2 max-w-2xl text-xs text-muted-foreground leading-relaxed">
            Paste a news article or URL below to extract factual claims, search live sources, and
            compute a credibility rating using Groq LLMs and real-time search. Or just ask a
            question, and get an answer with cited sources.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <InputForm
            loading={isLoading}
            serverError={serverError}
            userKey={userKey}
            onSubmit={(input) => {
              setServerError(null);
              setResult(null);
              mutation.mutate(input);
            }}
          />

          {isLoading ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {progress?.mode === "answer"
                    ? "Researching your question"
                    : "Analyzing your article"}
                </h2>
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground hover:bg-white/10"
                >
                  <XCircle className="size-3.5" /> Cancel
                </button>
              </div>
              <ProcessingSteps progress={progress} />
              {debating && progress?.claims?.length ? (
                <LiveDebatePanel claims={progress.claims} live={live} />
              ) : (
                <ResultsSkeleton />
              )}
            </div>
          ) : mutation.isError &&
            !((mutation.error as Error).name === "AbortError") &&
            !serverError ? (
            <div className="glass-card p-6 text-center">
              <p className="text-sm text-foreground">We couldn't complete the analysis.</p>
              <p className="mt-1 text-xs text-muted-foreground">{mutation.error.message}</p>
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
