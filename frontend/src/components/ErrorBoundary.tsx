import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="glass-card max-w-md p-8 text-center">
            <h1 className="text-xl font-semibold">Something broke.</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              An unexpected error occurred. You can try reloading the page.
            </p>
            <button
              onClick={() => {
                this.reset();
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
