import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Database,
  Download,
  Loader2,
  LogOut,
  Moon,
  SlidersHorizontal,
  Sun,
  Trash2,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { downloadFile } from "@/lib/report";
import {
  clearHistory,
  exportUserData,
  getPrefs,
  getUserHistory,
  setPrefs,
  useUserKey,
  type UserPrefs,
} from "@/lib/user-store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — FactCheck AI" },
      { name: "description", content: "Manage your profile and appearance." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const userKey = useUserKey();
  const qc = useQueryClient();
  const [prefs, setPrefsState] = useState<UserPrefs | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  useEffect(() => {
    setPrefsState(getPrefs(userKey));
  }, [userKey]);

  const updatePrefs = (patch: Partial<UserPrefs>) => {
    setPrefsState(setPrefs(userKey, patch));
  };

  const handleExport = () => {
    const data = exportUserData(userKey);
    if (data.history.length === 0) {
      toast.info("Nothing to export yet — run a fact-check first.");
      return;
    }
    downloadFile(
      `factcheck-data-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
    toast.success(`Exported ${data.history.length} fact-checks`);
  };

  const handleClearHistory = () => {
    const count = getUserHistory(userKey).length;
    if (count === 0) {
      toast.info("Your history is already empty.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete all ${count} fact-checks in your history? This cannot be undone.`)
    )
      return;
    clearHistory(userKey);
    qc.invalidateQueries({ queryKey: ["history", userKey] });
    toast.success("History cleared");
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate({ to: "/" });
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and appearance.</p>
      </div>

      <section className="glass-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sun className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Appearance</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Choose how FactCheck AI looks to you.</p>
        <div className="grid grid-cols-2 gap-3">
          <ThemeOption
            active={theme === "light"}
            onClick={() => setTheme("light")}
            icon={<Sun className="size-4" />}
            label="Light"
          />
          <ThemeOption
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={<Moon className="size-4" />}
            label="Dark"
          />
        </div>
      </section>

      <section className="glass-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Analysis preferences</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Saved to your account and applied every time you analyze an article.
        </p>
        {prefs && (
          <div className="space-y-5">
            <div>
              <label
                htmlFor="pref-max-claims"
                className="mb-2 flex items-center justify-between text-sm font-medium"
              >
                <span>Default max claims to extract</span>
                <span className="tabular-nums text-primary">{prefs.defaultMaxClaims}</span>
              </label>
              <input
                id="pref-max-claims"
                type="range"
                min={1}
                max={10}
                step={1}
                value={prefs.defaultMaxClaims}
                onChange={(e) => updatePrefs({ defaultMaxClaims: Number(e.target.value) })}
                className="w-full accent-[color:var(--color-primary)]"
              />
            </div>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Auto-save drafts</span>
                <span className="block text-xs text-muted-foreground">
                  Keep unsent article text so you never lose it on refresh.
                </span>
              </span>
              <input
                type="checkbox"
                checked={prefs.autoSaveDraft}
                onChange={(e) => updatePrefs({ autoSaveDraft: e.target.checked })}
                className="size-4 accent-[color:var(--color-primary)]"
              />
            </label>
          </div>
        )}
      </section>

      <section className="glass-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Your data</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Your fact-check history is stored per account on this device.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Download className="size-4" /> Export all data (JSON)
          </button>
          <button
            onClick={handleClearHistory}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/20"
          >
            <Trash2 className="size-4" /> Clear history
          </button>
        </div>
      </section>

      <section className="glass-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Profile</h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-4">
            {user.avatar ? (
              <img src={user.avatar} alt="Avatar" className="size-12 rounded-full" />
            ) : (
              <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center text-lg font-semibold text-primary">
                {(user.name || user.email || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card p-6">
        <h2 className="mb-4 text-sm font-semibold">Account</h2>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/20"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        <Link to="/analyze" className="hover:underline">
          ← Back to analyzer
        </Link>
      </p>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition ${
        active
          ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
