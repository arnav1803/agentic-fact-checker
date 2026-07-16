import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pin, PinOff, Search, Trash2 } from "lucide-react";

import { deleteFactCheck } from "@/lib/api";
import { clearHistory, deleteEntry, getUserHistory, togglePin, useUserKey } from "@/lib/user-store";
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

type BandFilter = "all" | "high" | "mixed" | "low";

const BAND_FILTERS: { key: BandFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "Credible (≥70%)" },
  { key: "mixed", label: "Mixed (40–69%)" },
  { key: "low", label: "Low (<40%)" },
];

function inBand(score: number, band: BandFilter): boolean {
  if (band === "all") return true;
  if (band === "high") return score >= 0.7;
  if (band === "mixed") return score >= 0.4 && score < 0.7;
  return score < 0.4;
}

function HistoryPage() {
  const userKey = useUserKey();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["history", userKey],
    queryFn: () => getUserHistory(userKey),
  });

  const [search, setSearch] = useState("");
  const [band, setBand] = useState<BandFilter>("all");

  const items = useMemo(() => data ?? [], [data]);

  const stats = useMemo(() => {
    if (items.length === 0) return null;
    const avg = items.reduce((a, i) => a + i.credibility_score, 0) / items.length;
    return {
      total: items.length,
      avg,
      high: items.filter((i) => inBand(i.credibility_score, "high")).length,
      low: items.filter((i) => inBand(i.credibility_score, "low")).length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(
        (i) =>
          inBand(i.credibility_score, band) && (!q || i.article_text.toLowerCase().includes(q)),
      )
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
  }, [items, search, band]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["history", userKey] });

  const onTogglePin = (id: string) => {
    togglePin(userKey, id);
    refresh();
  };

  const onDelete = (id: string) => {
    deleteEntry(userKey, id);
    void deleteFactCheck(id); // best-effort server cleanup
    refresh();
    toast.success("Fact-check removed from your history");
  };

  const onClearAll = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete all fact-checks in your history? This cannot be undone.")
    )
      return;
    clearHistory(userKey);
    refresh();
    toast.success("History cleared");
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your past fact-check analyses, saved to this account.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            <Trash2 className="size-3.5" /> Clear all
          </button>
        )}
      </header>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Total checks" value={String(stats.total)} />
          <StatTile
            label="Avg. credibility"
            value={`${Math.round(stats.avg * 100)}%`}
            color={scoreBand(stats.avg).color}
          />
          <StatTile
            label="Credible articles"
            value={String(stats.high)}
            color="text-verdict-supports"
          />
          <StatTile
            label="Low credibility"
            value={String(stats.low)}
            color="text-verdict-refutes"
          />
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your checks…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BAND_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setBand(f.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  band === f.key
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No fact-checks yet — your analyses will be saved here per account.
          </p>
          <Link
            to="/analyze"
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Analyze an article
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-muted-foreground">
          No results match your search or filter.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((item) => {
            const bandInfo = scoreBand(item.credibility_score);
            return (
              <li
                key={item._id}
                className="glass-card relative p-5 transition hover:border-white/20"
              >
                <Link to="/history/$id" params={{ id: item._id }} className="block">
                  <div className="flex items-start justify-between gap-4 pr-16">
                    <p className="line-clamp-2 text-sm text-foreground">
                      {item.pinned && <Pin className="mr-1.5 inline size-3.5 text-primary" />}
                      {item.article_text}
                    </p>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${bandInfo.color}`}
                    >
                      {Math.round(item.credibility_score * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {relativeTime(item.created_at)}
                  </div>
                </Link>
                <div className="absolute right-4 top-4 flex items-center gap-1">
                  <button
                    onClick={() => onTogglePin(item._id)}
                    title={item.pinned ? "Unpin" : "Pin to top"}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  >
                    {item.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  </button>
                  <button
                    onClick={() => onDelete(item._id)}
                    title="Delete"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="glass-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
