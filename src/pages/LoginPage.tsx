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

  function handleRoleChange(newRole: Role) {
    setRole(newRole);
    if (newRole === "admin") {
      setEmployeeId("ADM001");
      setFullName("Sree Rad");
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
            aria-label={showEmployeeId ? "Hide employee ID" : "Show employee ID"}
            title={showEmployeeId ? "Hide" : "Show"}
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
            aria-label={showFullName ? "Hide full name" : "Show full name"}
            title={showFullName ? "Hide" : "Show"}
          >
            <EyeIcon open={showFullName} size={16} />
          </button>
        </div>

        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(event) => handleRoleChange(event.target.value as Role)}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="hr_support">HR Support</option>
          <option value="admin">Admin</option>
        </select>

        {role === "admin" && (
          <>
            <label htmlFor="secret-code">Secret code</label>
            <div className="input-with-toggle">
              <input
                id="secret-code"
                type={showSecretCode ? "text" : "password"}
                value={secretCode}
                onChange={(event) => setSecretCode(event.target.value)}
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
