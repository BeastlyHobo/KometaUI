import React, { createContext, useContext, useMemo, useState } from "react";

export type AuthMode = "basic" | "token" | "none";

type BasicAuth = { mode: "basic"; user: string; pass: string };
type TokenAuth = { mode: "token"; token: string };
type NoneAuth = { mode: "none" };

export type AuthState = BasicAuth | TokenAuth | NoneAuth;

type AuthContextValue = {
  authState: AuthState;
  requiredMode: AuthMode | null;
  setRequiredMode: (mode: AuthMode | null) => void;
  setBasicAuth: (user: string, pass: string) => void;
  setTokenAuth: (token: string) => void;
  clearAuth: () => void;
};

const AUTH_STORAGE_KEY = "kometaUiAuth";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function loadStoredAuth(): AuthState {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return { mode: "none" };
    }
    const parsed = JSON.parse(raw) as AuthState;
    if (parsed.mode === "basic" && parsed.user && parsed.pass) {
      return parsed;
    }
    if (parsed.mode === "token" && parsed.token) {
      return parsed;
    }
  } catch {
    return { mode: "none" };
  }
  return { mode: "none" };
}

export function storeAuth(state: AuthState): void {
  if (state.mode === "none") {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

export function authHeader(state: AuthState): Record<string, string> {
  if (state.mode === "basic") {
    const token = btoa(`${state.user}:${state.pass}`);
    return { Authorization: `Basic ${token}` };
  }
  if (state.mode === "token") {
    return { Authorization: `Bearer ${state.token}` };
  }
  return {};
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(() => loadStoredAuth());
  const [requiredMode, setRequiredMode] = useState<AuthMode | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      authState,
      requiredMode,
      setRequiredMode,
      setBasicAuth: (user, pass) => {
        const next = { mode: "basic", user, pass } as const;
        setAuthState(next);
        storeAuth(next);
        setRequiredMode(null);
      },
      setTokenAuth: (token) => {
        const next = { mode: "token", token } as const;
        setAuthState(next);
        storeAuth(next);
        setRequiredMode(null);
      },
      clearAuth: () => {
        const next = { mode: "none" } as const;
        setAuthState(next);
        storeAuth(next);
        setRequiredMode(null);
      }
    }),
    [authState, requiredMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
