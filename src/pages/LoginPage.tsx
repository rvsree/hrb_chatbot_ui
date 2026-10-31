import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, getBackendActivationStatus, validateLogin } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { Role, UserProfile } from "../types";
import EyeIcon from "../components/EyeIcon";
import CopyButton from "../components/CopyButton";
import HelpPopover from "../components/HelpPopover";
import AwsActivationWait from "../components/AwsActivationWait";

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
  // Phase 21 - set only once validateLogin() succeeds and the backend
  // reports all_running: false. While this is non-null, the form itself
  // is replaced by AwsActivationWait; proceedToApp() is what that
  // component calls once activation finishes (or the visitor overrides it).
  const [pendingLoginResult, setPendingLoginResult] = useState<{
    userProfile: UserProfile;
    mustResetSecretCode: boolean;
  } | null>(null);
  const [awsWaitActive, setAwsWaitActive] = useState(false);

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

  // Phase 21 - the actual login()/navigate() pair, split out of
  // handleSubmit so both the immediate "already running" path and
  // AwsActivationWait's own onProceed can call it.
  function proceedToApp(userProfile: UserProfile, mustResetSecretCode: boolean) {
    login(userProfile);
    navigate(mustResetSecretCode ? "/admin/reset-secret-code" : "/chat");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId.trim() || !fullName.trim() || isValidating) {
      return;
    }
    setIsValidating(true);
    setLoginError(null);
    try {
      const result = await validateLogin(employeeId.trim(), fullName.trim(), role, secretCode.trim() || undefined);
      // Phase 2 (hrb_chatbot_service Phase 265) - the backend's own login
      // response never includes a timezone (it has no way to know it);
      // the frontend is the only accurate source. Captured once here,
      // stored with the rest of the identity.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const userProfile = { ...result.userProfile, timezone };

      // Phase 21 - hrb_chatbot_service Phase 284: in local dev this always
      // resolves to all_running: true immediately (the backend no-ops
      // outside production), so this path is a no-op there. In production,
      // a paused AWS Demo environment (Phase 261) needs a visitor-facing
      // way back in - AwsActivationWait owns the resume/poll/timeout cycle.
      let allRunning = true;
      try {
        const activationStatus = await getBackendActivationStatus();
        allRunning = activationStatus.all_running;
      } catch {
        // An unknown activation state is treated the same as "not running
        // yet" - AwsActivationWait's own resume+poll+timeout cycle handles
        // a flaky activation check too, rather than silently proceeding
        // into a backend that might still be asleep.
        allRunning = false;
      }

      if (allRunning) {
        proceedToApp(userProfile, result.mustResetSecretCode);
      } else {
        setPendingLoginResult({ userProfile, mustResetSecretCode: result.mustResetSecretCode });
        setAwsWaitActive(true);
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setLoginError(error.message);
      } else {
        setLoginError("Something went wrong reaching the backend.");
      }
    } finally {
      setIsValidating(false);
    }
  }

  // Phase 21 - once a successful login's own backend-activation check comes
  // back false, the form itself is replaced by the wait screen - the
  // same reasoning as this file's other full-content swaps (isAdminTier),
  // just gated on this new state instead.
  if (awsWaitActive && pendingLoginResult) {
    return (
      <AwsActivationWait
        onProceed={() => proceedToApp(pendingLoginResult.userProfile, pendingLoginResult.mustResetSecretCode)}
      />
    );
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
          {ALL_SAMPLE_PERSONAS.map((persona) => (
            <p key={persona.role}>
              <strong>{SAMPLE_PERSONA_LABELS[persona.role]}</strong> - Employee ID: <strong>{persona.employeeId}</strong>,
              Emp Name: <strong>{persona.fullName}</strong>{" "}
              <CopyButton
                text={`${persona.employeeId} / ${persona.fullName}`}
                label={`${SAMPLE_PERSONA_LABELS[persona.role]} sample identity`}
                onCopied={() => {
                  setEmployeeId(persona.employeeId);
                  setFullName(persona.fullName);
                  handleRoleChange(persona.role);
                }}
              />
            </p>
          ))}
          <p>
            <a
              href="https://github.com/rvsree/hrb_emp_assist/blob/master/README.md#new-here-trying-the-live-demo"
              target="_blank"
              rel="noopener noreferrer"
            >
              Project documentation →
            </a>
          </p>
        </HelpPopover>
      </form>
    </div>
  );
}
