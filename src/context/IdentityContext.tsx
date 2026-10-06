import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
