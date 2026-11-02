import { useEffect, useRef, useState } from "react";
import { pingChatbotService, wakeUpChatbotService } from "../api/client";

// Phase 34 - the only 2 services this screen ever waits on (hrb_chatbot_
// service's own Phase 289/290). These exact display names already exist
// as the live AWS_DEMO_SERVICES config's own `display_name` field for
// these 2 services - mirrored here, not invented.
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  "hrb-chatbot": "Chatbot Backend",
  "hrb-api-gateway": "API Gateway",
};

// AWS App Runner's own real status strings (describe_service), mapped to
// plain language - not re-invented status names.
function friendlyStatus(awsStatus: string): string {
  if (awsStatus === "RUNNING") {
    return "Ready";
  }
  if (awsStatus === "ERROR") {
    return "Having trouble";
  }
  // PAUSED, OPERATION_IN_PROGRESS, or anything else still settling.
  return "Starting up...";
}

// Phase 24 - hrb_chatbot_service's own Phase 287/289. Shown the instant
// Sign In is clicked, BEFORE validateLogin() ever runs - hrb-chatbot
// (and, since Phase 289, hrb-api-gateway in front of it) must be
// confirmed reachable first. Phase 26 removed the old post-login
// AwsActivationWait screen for the other 5 services - those resume in
// the background now, non-blocking - so this is the only wait screen
// left in the login flow.
const POLL_INTERVAL_MS = 3000;
// Phase 26 - was 90000 (90s). Real-incident finding, 2026-11-01: a single
// paused App Runner service's own RESUME_SERVICE operation alone measured
// ~55-60s live, before the app's own cold start (heavy LangChain/ML
// dependency stack) even begins - 90s was cutting it close for ONE
// service and too short once Phase 289 widened this same wait to cover
// hrb-api-gateway too. 180s gives real headroom without the visitor
// staring at "taking longer than expected" while a resume that's about
// to succeed is still quietly in progress.
const TIMEOUT_MS = 180000;

interface ChatbotWakeWaitProps {
  // Called once hrb-chatbot answers /ping, or the visitor overrides the
  // wait via "Continue anyway" - never trap a visitor here.
  onProceed: () => void;
}

export default function ChatbotWakeWait({ onProceed }: ChatbotWakeWaitProps) {
  const [stuck, setStuck] = useState(false);
  // Phase 34 - the one-time snapshot from wakeUpChatbotService(), plus a
  // manual "hrb-chatbot is now Ready" override once /ping actually
  // succeeds (the real signal, independent of this snapshot going stale).
  const [serviceStatus, setServiceStatus] = useState<Record<string, string> | null>(null);
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
    setServiceStatus(null);
    clearTimers();

    async function pollOnce() {
      const reachable = await pingChatbotService();
      if (cycleIdRef.current !== thisCycleId) {
        return;
      }
      if (reachable) {
        clearTimers();
        // hrb-chatbot is confirmed reachable - show it as Ready regardless
        // of what the one-time wake-up snapshot said, since /ping is the
        // real signal and may have resolved well after that snapshot.
        setServiceStatus((previous) => (previous ? { ...previous, "hrb-chatbot": "RUNNING" } : previous));
        onProceed();
      }
    }

    // A rate-limited or failed wake-up call is treated the same as "still
    // waking up" - the /ping poll below is the only real signal here,
    // this call's own result is informational only (matches the
    // backend's own "resumed: false" being a non-error outcome).
    wakeUpChatbotService().then((result) => {
      if (cycleIdRef.current === thisCycleId && result?.services) {
        setServiceStatus(result.services);
      }
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
          <>
            <p>Waking up the chatbot service, please wait</p>
            {serviceStatus && (
              <ul className="wake-service-status-list">
                {Object.entries(serviceStatus).map(([serviceName, status]) => (
                  <li key={serviceName}>
                    {SERVICE_DISPLAY_NAMES[serviceName] ?? serviceName}: {friendlyStatus(status)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
