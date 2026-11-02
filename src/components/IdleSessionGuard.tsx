import { useEffect, useRef, useState } from "react";
import { useIdentity } from "../context/IdentityContext";

// Phase 35 - 10 minutes of no real activity -> signed out. The last 60
// seconds of that budget show a "still there?" warning first, so a
// visitor who stepped away briefly gets a chance to stay signed in
// instead of silently losing their session.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const WARNING_DURATION_MS = 60 * 1000;
const WARNING_DELAY_MS = IDLE_TIMEOUT_MS - WARNING_DURATION_MS;

// Real activity only - not every DOM event, so a background tab or a
// stray script can't keep a session alive forever.
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"] as const;

// Timer resets are cheap, but a moving mouse can fire this dozens of
// times a second - this keeps it to at most one reset per second.
const ACTIVITY_THROTTLE_MS = 1000;

// Mounted once inside RequireIdentity (App.tsx), so it watches every
// signed-in page uniformly, not just the chat page.
export default function IdleSessionGuard() {
  const { logout } = useIdentity();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_DURATION_MS / 1000);

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastResetRef = useRef(0);
  // Phase 53 - lets handleActivity() read the current value without being
  // in the main effect's dependency array (see below for why that effect
  // must run only once).
  const showWarningRef = useRef(false);
  // Avoids calling logout() (and its own fire-and-forget sign-out
  // request) twice if both the countdown's own setTimeout and an
  // explicit "No" click land in the same tick.
  const loggedOutRef = useRef(false);

  function clearAllTimers() {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownIntervalRef.current = null;
  }

  function doLogout() {
    if (loggedOutRef.current) {
      return;
    }
    loggedOutRef.current = true;
    clearAllTimers();
    setShowWarning(false);
    logout();
  }

  function showWarningNow() {
    setShowWarning(true);
    setSecondsLeft(WARNING_DURATION_MS / 1000);
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    logoutTimerRef.current = setTimeout(doLogout, WARNING_DURATION_MS);
  }

  function scheduleWarning() {
    clearAllTimers();
    warningTimerRef.current = setTimeout(showWarningNow, WARNING_DELAY_MS);
  }

  function extendSession() {
    loggedOutRef.current = false;
    setShowWarning(false);
    scheduleWarning();
  }

  // Phase 53 - keeps showWarningRef in sync, cheaply, without the main
  // effect below needing showWarning in its own dependency array (that
  // was the real bug: re-running THAT effect on every showWarning change
  // called clearAllTimers() on the countdown/logout timers moments after
  // showWarningNow() had just created them).
  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  useEffect(() => {
    scheduleWarning();

    function handleActivity() {
      // Once the warning is showing, only an explicit button click (or
      // the countdown expiring) resolves it - a security-conscious
      // choice, not an oversight: the whole point of asking is to
      // confirm a human is actually there, which passive mouse/keyboard
      // noise doesn't establish.
      if (showWarningRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastResetRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastResetRef.current = now;
      scheduleWarning();
    }

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }
    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, handleActivity);
      }
      clearAllTimers();
    };
    // Runs exactly once on mount now - see the comment above for why this
    // must never re-run on showWarning changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!showWarning) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2>Still there?</h2>
        <p>
          You've been inactive for a while. For your security, you'll be signed out in{" "}
          <strong>{secondsLeft}</strong> second{secondsLeft === 1 ? "" : "s"}.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={extendSession}>
            Yes, keep me signed in
          </button>
          <button type="button" className="secondary" onClick={doLogout}>
            No, sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
