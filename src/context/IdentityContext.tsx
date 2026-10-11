import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiRequestError, validateLogin } from "../api/client";
import type { UserProfile } from "../types";

const STORAGE_KEY = "hrb_chatbot_identity";

interface IdentityContextValue {
  identity: UserProfile | null;
  login: (profile: UserProfile) => void;
  logout: () => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

function loadStoredIdentity(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<UserProfile | null>(loadStoredIdentity);

  useEffect(() => {
    try {
      if (identity) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Browser storage can throw (private window, blocked site data) -
      // the app still works for this session, just without persistence.
    }
  }, [identity]);

  // Phase 146: a stored identity was never re-checked against the backend
  // after the initial login - a persona valid when it was first saved (or
  // saved before Phase 106's known-personas check even existed) could
  // silently go stale forever, with no visible symptom beyond confusing
  // downstream failures (e.g. "Employee not found" from MCP tool calls
  // for an id like "E200" that was never a real known persona - confirmed
  // live in this project's own logs). Runs once on mount only - re-uses
  // the exact same validateLogin() call the login form itself uses, so
  // "known persona" is defined in exactly one place, not duplicated here.
  // Only an explicit 401/UNKNOWN_PERSONA rejection logs the user out - a
  // network error or backend hiccup must not punish an otherwise-valid
  // session.
  useEffect(() => {
    if (!identity) {
      return;
    }
    let cancelled = false;
    validateLogin(identity.employee_id, identity.full_name, identity.role).catch((error) => {
      if (cancelled) {
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        setIdentity(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only, not on every identity change this effect itself could cause
  }, []);

  function login(profile: UserProfile) {
    setIdentity(profile);
  }

  function logout() {
    setIdentity(null);
  }

  return <IdentityContext.Provider value={{ identity, login, logout }}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used within an IdentityProvider");
  }
  return context;
}
