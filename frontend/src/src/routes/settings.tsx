import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, LogOut, Moon, Sun, User as UserIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

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
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        setProfileLoaded(true);
      });
  }, [user]);

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("id", user.id);
    setSavingName(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
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
          <UserIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Profile</h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <input
              value={user.email ?? ""}
              disabled
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </div>
          <div>
            <label htmlFor="dn" className="mb-1 block text-xs font-medium text-muted-foreground">
              Display name
            </label>
            <input
              id="dn"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              disabled={!profileLoaded}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={saveName}
            disabled={savingName || !profileLoaded}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {savingName && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </button>
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
        <Link to="/" className="hover:underline">
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
