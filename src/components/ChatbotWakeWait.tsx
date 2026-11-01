import { useEffect, useRef, useState } from "react";
import { pingChatbotService, wakeUpChatbotService } from "../api/client";

// Phase 24 - hrb_chatbot_service's own Phase 287. Shown the instant Sign
// In is clicked, BEFORE validateLogin() ever runs - hrb-chatbot hosts
// that very call, so it must be confirmed reachable first. Distinct from
// AwsActivationWait (which polls a status object for the OTHER 5
// services, only after a successful login) - this one polls a plain
// /ping and runs first. Same 90s-timeout -> "Continue anyway"/"Try
// again" shape as that component, for visual/behavioral consistency.
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 90000;

interface ChatbotWakeWaitProps {
  // Called once hrb-chatbot answers /ping, or the visitor overrides the
  // wait via "Continue anyway" - never trap a visitor here.
  onProceed: () => void;
}

export default function ChatbotWakeWait({ onProceed }: ChatbotWakeWaitProps) {
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
      const reachable = await pingChatbotService();
      if (cycleIdRef.current !== thisCycleId) {
        return;
      }
      if (reachable) {
        clearTimers();
        onProceed();
      }
    }

    // A rate-limited or failed wake-up call is treated the same as "still
    // waking up" - the /ping poll below is the only real signal here,
    // this call's own result is informational only (matches the
    // backend's own "resumed: false" being a non-error outcome).
    wakeUpChatbotService();

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
          <p>Waking up the chatbot service, please wait</p>
        )}
      </div>
    </div>
  );
}
