import { forwardRef, useEffect, useId, useState } from "react";
import { ChevronDown, FastForward, Play, Users } from "lucide-react";
import type { ClaimDebate, Verdict } from "@/lib/types";
import { DebateView } from "./DebateView";
import { useDebateReplay } from "./state";
import { verdictStance } from "./stance";

interface Props {
  debates: ClaimDebate[];
  verdicts: Verdict[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: number;
  onClaimChange: (claim: number) => void;
}

/**
 * The finished debates, kept on the results page in a collapsible section:
 * pick a claim to see its table, transcript and ruling, or replay it.
 */
export const DebateReview = forwardRef<HTMLElement, Props>(function DebateReview(
  { debates, verdicts, open, onOpenChange, claim, onClaimChange },
  ref,
) {
  const bodyId = useId();
  // Mount the heavy table on first open, then keep it so closing can animate
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const sorted = [...debates].sort((a, b) => a.claim_index - b.claim_index);
  const current = sorted.find((d) => d.claim_index === claim) ?? sorted[0];
  const argued = sorted.filter((d) => d.record?.camp_turns?.length).length;
  const flagged = sorted.reduce((n, d) => n + (d.record?.final?.unreliable_agents?.length ?? 0), 0);
  const summary = [
    `${sorted.length} ${sorted.length === 1 ? "claim" : "claims"}`,
    argued ? `${argued} argued between groups` : "no disputes between sources",
    flagged ? `${flagged} ${flagged === 1 ? "source" : "sources"} flagged` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      ref={ref}
      className="glass-card scroll-mt-6 overflow-hidden"
      aria-label="Agent debates"
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onOpenChange(!open)}
          className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Users className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              How the sources debated
            </span>
            <span className="block text-xs text-muted-foreground">{summary}</span>
          </span>
          <span className="hidden items-center gap-1.5 sm:flex" aria-hidden>
            {sorted.map((d) => {
              const v = verdicts[d.claim_index];
              return (
                <span
                  key={d.claim_index}
                  className="size-2.5 rounded-full"
                  style={{
                    background: v ? verdictStance(v.verdict).color : "var(--muted-foreground)",
                  }}
                />
              );
            })}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          {mounted && current ? (
            <div className="space-y-5 border-t border-border px-5 pb-6 pt-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Claims">
                {sorted.map((d) => {
                  const v = verdicts[d.claim_index];
                  const s = v ? verdictStance(v.verdict) : null;
                  const active = d.claim_index === current.claim_index;
                  return (
                    <button
                      key={d.claim_index}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={d.claim}
                      onClick={() => onClaimChange(d.claim_index)}
                      className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs transition-colors ${
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="font-semibold">Claim {d.claim_index + 1}</span>
                      {s ? (
                        <>
                          <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                          <span style={{ color: s.color }}>{s.label}</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <ReviewPlayer key={current.claim_index} debate={current} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

/** One claim's finished debate, shown at its end state with an inline replay. */
function ReviewPlayer({ debate }: { debate: ClaimDebate }) {
  const { state, playing, play, skip, speed, setSpeed } = useDebateReplay(debate.record, {
    autoPlay: false,
  });
  if (!debate.record) {
    return (
      <p className="text-sm text-muted-foreground">
        No debate was held for this claim: no usable sources were found, so it was checked with a
        single model call.
      </p>
    );
  }
  const btn =
    "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";
  return (
    <DebateView
      state={state}
      sources={debate.sources}
      mode="verdict"
      subject={debate.claim}
      actions={
        playing ? (
          <>
            <button type="button" className={btn} onClick={() => setSpeed(speed === 1 ? 3 : 1)}>
              {speed === 1 ? "3× speed" : "1× speed"}
            </button>
            <button type="button" className={btn} onClick={skip}>
              <FastForward className="size-3.5" /> Skip to end
            </button>
          </>
        ) : (
          <button type="button" className={btn} onClick={play}>
            <Play className="size-3.5" /> Replay
          </button>
        )
      }
    />
  );
}
