import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, resumeBackendActivation, validateLogin, type LoginResult } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { Role, UserProfile } from "../types";
import EyeIcon from "../components/EyeIcon";
import CopyButton from "../components/CopyButton";
import HelpPopover from "../components/HelpPopover";
import ChatbotWakeWait from "../components/ChatbotWakeWait";

// Phase 282 - matches the backend's own Pydantic `pattern` constraint
// (models/common.py/auth.py) exactly - this is a UX nicety (fail fast,
// clear native browser message), not the real security boundary, which
// stays server-side (login.py's known-personas allowlist).
const EMPLOYEE_ID_PATTERN = "[A-Za-z0-9]+";
const EMP_NAME_PATTERN = "[A-Za-z\\s'\\-]+";

// Phase 18 - one real, documented sample per non-admin role (the same
// personas already used as this project's own canonical examples
// throughout its docs) - not the full KNOWN-PERSONAS.md roster, just
// enough to unblock a visitor who doesn't know what to type.
const SAMPLE_PERSONAS: Partial<Record<Role, { employeeId: string; fullName: string }>> = {
  employee: { employeeId: "EMP052", fullName: "Eddy Employee" },
  manager: { employeeId: "EMP053", fullName: "Mia Manager" },
  hr_support: { employeeId: "EMP051", fullName: "Hana Support" },
};

// Phase 21 - derived from SAMPLE_PERSONAS above (not a second hand-written
// copy of the same 3 personas), in the same order the Role <select>'s own
// options list them, for the "Sample login" popup to map over.
const ALL_SAMPLE_PERSONAS = (["employee", "manager", "hr_support"] as const).map((sampleRole) => ({
  role: sampleRole,
  ...SAMPLE_PERSONAS[sampleRole]!,
}));

// Matches the Role <select>'s own option text for these 3 roles.
const SAMPLE_PERSONA_LABELS: Record<"employee" | "manager" | "hr_support", string> = {
  employee: "Employee",
  manager: "Manager",
  hr_support: "HR Support",
};

export default function LoginPage() {
  const { login } = useIdentity();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [secretCode, setSecretCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showEmployeeId, setShowEmployeeId] = useState(false);
  const [showFullName, setShowFullName] = useState(false);
  const [showSecretCode, setShowSecretCode] = useState(false);
  // Milestone 2 - employee_id/full_name reveal is gated on the secret
  // code being objectively correct, for the admin role only. Checked on
  // blur, not on every keystroke - a check-per-keystroke would mean a
  // real login attempt per keystroke, which would collide with the
  // lockout Milestone 3 adds (a user's own typos while typing the
  // correct code could lock them out before they finish).
  const [isSecretCodeVerified, setIsSecretCodeVerified] = useState(false);
  const [isCheckingSecretCode, setIsCheckingSecretCode] = useState(false);
  const isAdminTier = role === "admin" || role === "employee_admin";
  const revealGatedOnSecretCode = isAdminTier;
  const revealAllowed = !revealGatedOnSecretCode || isSecretCodeVerified;
  // Phase 24 (hrb_chatbot_service's own Phase 287) - set the instant Sign
  // In is clicked, BEFORE validateLogin() ever runs. While true, the form
  // is replaced by ChatbotWakeWait; performLogin() is what that
  // component's onProceed calls once hrb-chatbot answers /ping (or the
  // visitor overrides the wait).
  const [chatbotWakeActive, setChatbotWakeActive] = useState(false);

  function handleSecretCodeChange(value: string) {
    setSecretCode(value);
    // Stale verification from a previous value must not keep reveal open
    // once the field changes again - re-collapse until the next blur re-checks.
    if (isSecretCodeVerified) {
      setIsSecretCodeVerified(false);
      setShowEmployeeId(false);
      setShowFullName(false);
    }
  }

  async function handleSecretCodeBlur() {
    if (!isAdminTier || !employeeId.trim() || !fullName.trim() || !secretCode.trim()) {
      return;
    }
    setIsCheckingSecretCode(true);
    try {
      await validateLogin(employeeId.trim(), fullName.trim(), role, secretCode.trim(), false);
      setIsSecretCodeVerified(true);
    } catch {
      setIsSecretCodeVerified(false);
    } finally {
      setIsCheckingSecretCode(false);
    }
  }

  function handleRoleChange(newRole: Role) {
    setRole(newRole);
    setIsSecretCodeVerified(false);
    setShowEmployeeId(false);
    setShowFullName(false);
    if (newRole === "admin") {
      setEmployeeId("ADM001");
      setFullName("Sree Rad");
    } else if (newRole === "employee_admin") {
      setEmployeeId("ADM002");
      setFullName("Erin Admin");
    }
  }

  // Phase 21 - the actual login()/navigate() pair, split out of performLogin.
  function proceedToApp(userProfile: UserProfile, mustResetSecretCode: boolean) {
    login(userProfile);
    navigate(mustResetSecretCode ? "/admin/reset-secret-code" : "/chat");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId.trim() || !fullName.trim() || isValidating) {
      return;
    }
    // Phase 24 - swap to ChatbotWakeWait immediately; performLogin() (the
    // real validateLogin() call) only runs once that component confirms
    // hrb-chatbot is reachable.
    setLoginError(null);
    setChatbotWakeActive(true);
  }

  // Phase 34 - a transient 404/502/503/504 right after ChatbotWakeWait's
  // own /ping succeeded is a real, observed race: /ping only confirms
  // hrb-chatbot answers a cheap GET, not that hrb-api-gateway's own
  // routing has finished warming up for a POST. Most such races resolve
  // within a few seconds, so retry silently before ever showing the
  // visitor an error.
  const LOGIN_RETRY_ATTEMPTS = 2;
  const LOGIN_RETRY_DELAY_MS = 3000;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function performLogin() {
    setChatbotWakeActive(false);
    setIsValidating(true);
    try {
      let result: LoginResult;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await validateLogin(employeeId.trim(), fullName.trim(), role, secretCode.trim() || undefined);
          break;
        } catch (error) {
          const likelyTransient =
            error instanceof ApiRequestError && [404, 502, 503, 504].includes(error.status);
          if (!likelyTransient || attempt >= LOGIN_RETRY_ATTEMPTS) {
            throw error;
          }
          await sleep(LOGIN_RETRY_DELAY_MS);
        }
      }
      // Phase 2 (hrb_chatbot_service Phase 265) - the backend's own login
      // response never includes a timezone (it has no way to know it);
      // the frontend is the only accurate source. Captured once here,
      // stored with the rest of the identity.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const userProfile = { ...result.userProfile, timezone };

      // Phase 26 (hrb_chatbot_service's own Phase 289 fix) - a real
      // incident this session: Phase 21/284's own wait screen used to
      // block the chat page behind ALL 5 other AWS Demo services, even
      // though a basic first chat message needs none of them (confirmed
      // by reading the actual pipeline code - it never calls out to the
      // 2 standalone RAG services over the network, and hrb-lms-mcp/
      // hrb-platform-components are only needed for specific questions/
      // admin pages, not every message). Fire the resume in the
      // background instead of waiting on it - a visitor goes straight to
      // chat; a question that genuinely needs one of those services
      // (e.g. a leave-balance lookup) may briefly fail if asked before it
      // finishes waking, which the agent's own tool-calling error
      // handling already covers, same as any other backend hiccup.
      resumeBackendActivation().catch(() => {
        // Intentionally ignored - see comment above.
      });

      proceedToApp(userProfile, result.mustResetSecretCode);
    } catch (error) {
      // Phase 23/24 (hrb_chatbot_service's own real incident, 2026-10-31) -
      // a paused/unreachable backend answers login with a bare 404 (App
      // Runner's own front door, not this app's json_error shape) in
      // under a second - confirmed live. That's not a real credential
      // problem, so it gets its own message instead of the raw
      // "Request failed with status 404" text, which would otherwise
      // read as if something was actually wrong with the login itself.
      const likelyUnreachableBackend =
        error instanceof ApiRequestError && [404, 502, 503, 504].includes(error.status);
      if (likelyUnreachableBackend) {
        setLoginError("Having trouble reaching the server - it may be starting up. Please try again in a moment.");
      } else if (error instanceof ApiRequestError) {
        setLoginError(error.message);
      } else {
        setLoginError("Something went wrong reaching the backend.");
      }
    } finally {
      setIsValidating(false);
    }
  }

  // Phase 24 - runs before validateLogin() ever gets a chance to fail
  // against a paused hrb-chatbot.
  if (chatbotWakeActive) {
    return <ChatbotWakeWait onProceed={performLogin} />;
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>HRB Chatbot</h1>

        <label htmlFor="employee-id">Emp ID</label>
        {isAdminTier ? (
          <div className="input-with-toggle">
            <input
              id="employee-id"
              type={showEmployeeId ? "text" : "password"}
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              placeholder="E100"
              required
            />
            <button
              type="button"
              className="input-toggle-button"
              onClick={() => setShowEmployeeId((current) => !current)}
              disabled={!revealAllowed}
              aria-label={showEmployeeId ? "Hide employee ID" : "Show employee ID"}
              title={revealAllowed ? (showEmployeeId ? "Hide" : "Show") : "Enter the correct secret code to reveal"}
            >
              <EyeIcon open={showEmployeeId} size={16} />
            </button>
          </div>
        ) : (
          <input
            id="employee-id"
            type="text"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            placeholder="E100"
            pattern={EMPLOYEE_ID_PATTERN}
            title="Letters and numbers only"
            required
          />
        )}

        <label htmlFor="full-name">Emp Name</label>
        {isAdminTier ? (
          <div className="input-with-toggle">
            <input
              id="full-name"
              type={showFullName ? "text" : "password"}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Jane Doe"
              required
            />
            <button
              type="button"
              className="input-toggle-button"
              onClick={() => setShowFullName((current) => !current)}
              disabled={!revealAllowed}
              aria-label={showFullName ? "Hide full name" : "Show full name"}
              title={revealAllowed ? (showFullName ? "Hide" : "Show") : "Enter the correct secret code to reveal"}
            >
              <EyeIcon open={showFullName} size={16} />
            </button>
          </div>
        ) : (
          <input
            id="full-name"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Jane Doe"
            pattern={EMP_NAME_PATTERN}
            title="Letters, spaces, hyphens, and apostrophes only"
            required
          />
        )}

        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(event) => handleRoleChange(event.target.value as Role)}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="hr_support">HR Support</option>
          <option value="admin">DevOps</option>
          <option value="employee_admin">Admin</option>
        </select>

        {isAdminTier && (
          <>
            <label htmlFor="secret-code">Secret code</label>
            <div className="input-with-toggle">
              <input
                id="secret-code"
                type={showSecretCode ? "text" : "password"}
                value={secretCode}
                onChange={(event) => handleSecretCodeChange(event.target.value)}
                onBlur={handleSecretCodeBlur}
                placeholder="Admin secret code"
                required
              />
              <button
                type="button"
                className="input-toggle-button"
                onClick={() => setShowSecretCode((current) => !current)}
                aria-label={showSecretCode ? "Hide secret code" : "Show secret code"}
                title={showSecretCode ? "Hide" : "Show"}
              >
                <EyeIcon open={showSecretCode} size={16} />
              </button>
            </div>
            {isCheckingSecretCode && <p className="dev-note-inline">Checking...</p>}
            {!isCheckingSecretCode && isSecretCodeVerified && (
              <p className="dev-note-inline">Secret code verified - employee ID and full name can now be revealed.</p>
            )}
          </>
        )}

        {loginError && <p className="error-banner">{loginError}</p>}

        <button type="submit" disabled={isValidating}>
          {isValidating ? "Signing in..." : "Sign in"}
        </button>
        {/* Phase 21 (2nd correction) - the persistent link IS this
            popover's own trigger now (no separate "?" icon anywhere on
            the form), lists all 3 non-admin personas together (Employee
            -> Manager -> HR Support, matching the <select>'s own option
            order), each with its own copy icon that also switches Role
            to match. */}
        <HelpPopover label="Sample login" triggerContent="Need sample login credentials?" triggerClassName="link-button login-sample-credentials-link">
          {(closePopover) => (
            <>
              <table className="sample-login-grid">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Employee ID</th>
                    <th>Emp Name</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_SAMPLE_PERSONAS.map((persona) => (
                    <tr key={persona.role}>
                      <td>{SAMPLE_PERSONA_LABELS[persona.role]}</td>
                      <td>{persona.employeeId}</td>
                      <td>{persona.fullName}</td>
                      <td>
                        <CopyButton
                          text={`${persona.employeeId} / ${persona.fullName}`}
                          label={`${SAMPLE_PERSONA_LABELS[persona.role]} sample identity`}
                          onCopied={() => {
                            setEmployeeId(persona.employeeId);
                            setFullName(persona.fullName);
                            handleRoleChange(persona.role);
                            // Phase 29 - user-reported: picking a persona filled
                            // the form correctly, but the popover itself stayed
                            // open - close it now that there's nothing left to do.
                            closePopover();
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sample-login-doc-link">
                <a
                  href="https://github.com/rvsree/hrb_emp_assist/blob/master/README.md#new-here-trying-the-live-demo"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Project documentation →
                </a>
              </p>
            </>
          )}
        </HelpPopover>
      </form>
    </div>
  );
}
