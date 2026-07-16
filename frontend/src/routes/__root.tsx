import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LogIn, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md p-8 text-center">
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <h2 className="mt-3 text-lg font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/analyze"
          className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to FactCheck AI
        </Link>
      </div>
    </div>
  );
}

function RootErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">This page didn't load.</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong on our end.</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FactCheck AI — AI-powered news verification" },
      {
        name: "description",
        content:
          "Paste any news article and get an AI-powered credibility score with per-claim verdicts and cited sources in seconds.",
      },
      {
        property: "og:title",
        content: "FactCheck AI — AI-powered news verification",
      },
      {
        property: "og:description",
        content: "AI-powered news verification in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "FactCheck AI — AI-powered news verification",
      },
      {
        name: "twitter:description",
        content: "AI-powered news verification in seconds.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: RootErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function AuthLinks() {
  const { user, loading } = useAuth();
  if (loading) return <div className="size-8" />;
  if (user) {
    const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
    return (
      <Link
        to="/settings"
        activeProps={{ className: "ring-1 ring-primary/40" }}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
        title="Settings"
      >
        {user.avatar ? (
          <img src={user.avatar} alt="Avatar" className="size-7 rounded-full" />
        ) : (
          <span className="grid size-7 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            {initial}
          </span>
        )}
        <Settings className="size-4" />
      </Link>
    );
  }
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      <LogIn className="size-3.5" />
      Sign in
    </Link>
  );
}

function Header() {
  return (
    <header className="relative z-10 border-b border-border bg-background/40 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8">
        <Link to="/analyze" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <ShieldCheck className="size-5" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">FactCheck AI</div>
            <div className="text-[11px] text-muted-foreground">AI-powered news verification</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/analyze"
            activeOptions={{ exact: true }}
            activeProps={{ className: "bg-white/10 text-foreground" }}
            className="rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            Analyze
          </Link>
          <Link
            to="/history"
            activeProps={{ className: "bg-white/10 text-foreground" }}
            className="rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            History
          </Link>
          <div className="mx-1 h-5 w-px bg-border" />
          <ThemeToggleButton />
          <AuthLinks />
        </nav>
      </div>
    </header>
  );
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-right" richColors />;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ErrorBoundary>
            <div className="relative min-h-screen">
              <Header />
              <main className="relative z-10 mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
                <Outlet />
              </main>
              <ThemedToaster />
            </div>
          </ErrorBoundary>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
