import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, validateLogin } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { Role } from "../types";

export default function LoginPage() {
  const { login } = useIdentity();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [isValidating, setIsValidating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId.trim() || !fullName.trim() || isValidating) {
      return;
    }
    setIsValidating(true);
    setLoginError(null);
    try {
      const userProfile = await validateLogin(employeeId.trim(), fullName.trim(), role);
      login(userProfile);
      navigate("/chat");
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
        <p className="dev-note">
          Sign-in is checked against a small known-personas list on the backend (Phase 106) -
          an unknown id/name/role combo is denied. This still isn't real authentication: once
          signed in, role is self-asserted on every request, same as before (see BACKLOG.md).
        </p>

        <label htmlFor="employee-id">Employee ID</label>
        <input
          id="employee-id"
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
          placeholder="E100"
          required
        />

        <label htmlFor="full-name">Full name</label>
        <input
          id="full-name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Jane Doe"
          required
        />

        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="hr_support">HR Support</option>
        </select>

        {loginError && <p className="error-banner">{loginError}</p>}

        <button type="submit" disabled={isValidating}>
          {isValidating ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
