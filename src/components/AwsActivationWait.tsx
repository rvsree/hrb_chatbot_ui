import { useEffect, useRef, useState } from "react";
import { getBackendActivationStatus, resumeBackendActivation } from "../api/client";

// Phase 21 - hrb_chatbot_service's own Phase 284. This is only ever shown
// after a successful login whose own backend-activation check already
// came back all_running: false - so by the time this mounts, that first
// check is done; this component owns only the resume+poll+timeout cycle
// that follows, not the initial check (LoginPage.tsx's own handleSubmit).
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 90000;

interface AwsActivationWaitProps {
  // Called once activation is confirmed running, or the visitor
  // overrides the wait via "Continue anyway" - never trap a visitor here.
  onProceed: () => void;
}

export default function AwsActivationWait({ onProceed }: AwsActivationWaitProps) {
  const [stuck, setStuck] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a poll result arriving after this effect's own cleanup ran
  // (component unmounted, or "Try again" started a newer cycle).
  const cycleIdRef = useRef(0);

  function clearTimers() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
    }
    pollTimerRef.current = null;
    timeoutTimerRef.current = null;
  }

  function startCycle() {
    cycleIdRef.current += 1;
    const thisCycleId = cycleIdRef.current;
    setStuck(false);
    clearTimers();

    async function pollOnce() {
      try {
        const status = await getBackendActivationStatus();
        if (cycleIdRef.current !== thisCycleId) {
          return;
        }
        if (status.all_running) {
          clearTimers();
          onProceed();
        }
      } catch {
        if (cycleIdRef.current !== thisCycleId) {
          return;
        }
        // The status check itself failing - unlike a resume 429 below,
        // this isn't "someone else's activation already in flight," it's
        // "we can't tell what's happening" - surface the fallback now
        // rather than keep silently retrying.
        clearTimers();
        setStuck(true);
      }
    }

    // A 429 (rate-limited) or any other resume failure is treated the same
    // as "still polling" - the visitor's own earlier trigger (or someone
    // else's) may already be resuming things, so polling continues
    // regardless of whether this particular resume call succeeded.
    resumeBackendActivation().catch(() => {
      // Intentionally ignored - see comment above.
    });

    pollOnce();
    pollTimerRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    timeoutTimerRef.current = setTimeout(() => {
      if (cycleIdRef.current !== thisCycleId) {
        return;
      }
      clearTimers();
      setStuck(true);
    }, TIMEOUT_MS);
  }

  useEffect(() => {
    startCycle();
    return () => {
      cycleIdRef.current += 1;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="centered-page">
      <div className="card login-card">
        <h1>HRB Chatbot</h1>
        {stuck ? (
          <>
            <p>This is taking longer than expected.</p>
            <button type="button" onClick={onProceed}>
              Continue anyway
            </button>
            <button type="button" className="secondary" onClick={startCycle}>
              Try again
            </button>
          </>
        ) : (
          <p>We are activating backend services in AWS, please wait</p>
        )}
      </div>
    </div>
  );
}
