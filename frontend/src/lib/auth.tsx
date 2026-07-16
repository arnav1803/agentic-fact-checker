import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface User {
  email: string;
  name: string;
  avatar?: string;
  id?: string;
}

interface Session {
  user: User;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: (email?: string, name?: string, picture?: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AUTH_KEY = "factcheck_auth_user";

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      setLoading(false);
      return;
    }
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      if (stored) {
        const user: User = JSON.parse(stored);
        setSession({ user });
      }
    } catch {
      localStorage.removeItem(AUTH_KEY);
    }
    setLoading(false);
  }, []);

  const persistUser = (user: User) => {
    if (typeof window !== "undefined") localStorage.setItem(AUTH_KEY, JSON.stringify(user));
    setSession({ user });
  };

  const signInWithGoogle = async (email?: string, name?: string, avatar?: string) => {
    persistUser({
      email: email || "user@gmail.com",
      name: name || "Google User",
      avatar,
    });
  };

  const signInWithEmail = async (email: string, _password: string) => {
    persistUser({ email, name: email.split("@")[0] });
  };

  const signUpWithEmail = async (email: string, _password: string) => {
    persistUser({ email, name: email.split("@")[0] });
  };

  const signOut = async () => {
    if (typeof window !== "undefined") localStorage.removeItem(AUTH_KEY);
    setSession(null);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
