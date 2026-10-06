import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useIdentity } from "../context/IdentityContext";
import type { Role } from "../types";

export default function LoginPage() {
  const { login } = useIdentity();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("employee");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!employeeId.trim() || !fullName.trim()) {
      return;
    }
    login({ employee_id: employeeId.trim(), full_name: fullName.trim(), role });
    navigate("/chat");
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>HRB Chatbot</h1>
        <p className="dev-note">
          Real OAuth/JWT sign-in isn't built on the backend yet (see BACKLOG.md). This form
          collects the same <code>user_profile</code> fields (employee id, name, role) the API
          already checks on every request - a stand-in for the real login screen, not a fake one.
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

        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
