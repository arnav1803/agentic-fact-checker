import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, Pin } from "lucide-react";
import { getUserHistory, useUserKey } from "@/lib/user-store";
import { relativeTime, scoreBand } from "./verdict";

export function HistorySidebar() {
  const userKey = useUserKey();
  const { data } = useQuery({
    queryKey: ["history", userKey],
    queryFn: () => getUserHistory(userKey),
    staleTime: 10_000,
  });

  const items = (data ?? [])
    .slice()
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

  return (
    <aside className="glass-card h-fit p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4" /> Recent checks
        </h3>
        <Link to="/history" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No fact-checks yet — analyze your first article. Your checks are saved to this account.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((item) => {
            const band = scoreBand(item.credibility_score);
            return (
              <li key={item._id}>
                <Link
                  to="/history/$id"
                  params={{ id: item._id }}
                  className="block rounded-lg border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/5"
                >
                  <p className="line-clamp-2 text-xs text-foreground">
                    {item.pinned && <Pin className="mr-1 inline size-3 text-primary" />}
                    {item.article_text.slice(0, 60)}
                    {item.article_text.length > 60 ? "…" : ""}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`text-[11px] font-medium tabular-nums ${band.color}`}>
                      {Math.round(item.credibility_score * 100)}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {relativeTime(item.created_at)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
