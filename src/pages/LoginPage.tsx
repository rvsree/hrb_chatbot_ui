import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, validateLogin } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { Role } from "../types";
import EyeIcon from "../components/EyeIcon";

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId.trim() || !fullName.trim() || isValidating) {
      return;
    }
    setIsValidating(true);
    setLoginError(null);
    try {
      const result = await validateLogin(employeeId.trim(), fullName.trim(), role, secretCode.trim() || undefined);
      login(result.userProfile);
      navigate(result.mustResetSecretCode ? "/admin/reset-secret-code" : "/chat");
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

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>HRB Chatbot</h1>

        <label htmlFor="employee-id">Employee ID</label>
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

        <label htmlFor="full-name">Full name</label>
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
      </form>
    </div>
  );
}
