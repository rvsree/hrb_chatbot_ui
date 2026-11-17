import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiRequestError, signOut as signOutRequest, validateLogin } from "../api/client";
import type { UserProfile } from "../types";

const STORAGE_KEY = "hrb_chatbot_identity";
// Phase 23 (hrb_chatbot_service Phase 286) - deliberately sessionStorage,
// never localStorage/STORAGE_KEY above - sessionStorage is already scoped
// per browser tab, which is exactly the property needed: 2 tabs signed in
// as the same persona must get 2 different ids, not share one.
const TAB_SESSION_STORAGE_KEY = "hrb_chatbot_tab_session_id";
// Phase 55 (hrb_chatbot_service Phase 296) - also sessionStorage, but a
// distinct key and a distinct lifecycle from TAB_SESSION_STORAGE_KEY
// above: this one is regenerated on every real login() (one demo visit),
// not stable for the tab's whole lifetime.
const USER_SESSION_STORAGE_KEY = "hrb_chatbot_user_session_id";

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

function getOrCreateTabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage can throw (private window, blocked site data) - fall
    // back to an in-memory-only id for this render; presence tracking
    // just degrades to employee_id-based counting for this one tab.
    return crypto.randomUUID();
  }
}

// Phase 55 - loaded once on mount (survives a same-tab refresh while
// still signed in), but never created here if absent - unlike
// getOrCreateTabSessionId above, a missing one just stays undefined
// until the next real login() call creates it. A reopened tab with a
// localStorage-restored identity but no fresh login this tab is a known,
// accepted gap - see ROADMAP.md Phase 55's own "Open questions".
function loadUserSessionId(): string | null {
  try {
    return sessionStorage.getItem(USER_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Phase 55 - called from login() only, never getOrCreate: a fresh id
// every real sign-in is the actual point of this field (one id per demo
// visit), not a stable per-tab id like tab_session_id.
function createUserSessionId(): string {
  const fresh = crypto.randomUUID();
  try {
    sessionStorage.setItem(USER_SESSION_STORAGE_KEY, fresh);
  } catch {
    // sessionStorage can throw (private window, blocked site data) - the
    // id still works for this render, just won't survive a page refresh.
  }
  return fresh;
}

function clearUserSessionId(): void {
  try {
    sessionStorage.removeItem(USER_SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clean up if sessionStorage was never reachable.
  }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<UserProfile | null>(loadStoredIdentity);
  // Generated once per tab, on mount - never persisted to localStorage
  // (STORAGE_KEY above), so it's never shared between tabs the way the
  // rest of the identity deliberately is.
  const [tabSessionId] = useState<string>(getOrCreateTabSessionId);
  // Phase 55 - unlike tabSessionId, this one CAN change later (login()
  // below replaces it), so it needs its own setter, not just useState's
  // lazy initializer.
  const [userSessionId, setUserSessionId] = useState<string | null>(loadUserSessionId);

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
  //
  // Only an UNKNOWN_PERSONA rejection logs the user out - checking the
  // error CODE, not just a 401 status, matters specifically for an admin:
  // this call never has a secret code to send (never stored client-side),
  // so for role=admin the backend always rejects it with a real 401
  // (INVALID_ADMIN_SECRET_CODE) that has nothing to do with the persona
  // being valid. Checking status alone silently logged out every admin on
  // every page load/refresh - found live, confirmed via network trace.
  useEffect(() => {
    if (!identity) {
      return;
    }
    let cancelled = false;
    validateLogin(identity.employee_id, identity.full_name, identity.role).catch((error) => {
      if (cancelled) {
        return;
      }
      if (error instanceof ApiRequestError && error.code === "UNKNOWN_PERSONA") {
        setIdentity(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only, not on every identity change this effect itself could cause
  }, []);

  function login(profile: UserProfile) {
    // Phase 55 - a fresh id every real sign-in (one per demo visit), not
    // reused across a logout+re-login in the same tab the way
    // tabSessionId is.
    setUserSessionId(createUserSessionId());
    setIdentity(profile);
  }

  function logout() {
    // Phase 286 - fire-and-forget: the sign-out-triggered pause accelerant
    // never blocks (or can fail) the actual client-side sign-out below.
    // tabSessionId (not employee_id) is what lets the backend tell this
    // tab apart from another tab signed in as the same persona.
    if (identity) {
      void signOutRequest(identity.employee_id, tabSessionId);
    }
    // Phase 55 - cleared so the next sign-in in this tab gets a genuinely
    // new id, not a stale reused one.
    clearUserSessionId();
    setUserSessionId(null);
    setIdentity(null);
  }

  // tab_session_id/user_session_id are merged in here only - never part
  // of the `identity` state itself, so neither is ever written to
  // localStorage (the effect above persists the raw state, not this
  // derived value) and neither is ever shared between tabs.
  const exposedIdentity = identity
    ? { ...identity, tab_session_id: tabSessionId, user_session_id: userSessionId ?? undefined }
    : null;

  return <IdentityContext.Provider value={{ identity: exposedIdentity, login, logout }}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used within an IdentityProvider");
  }
  return context;
}
