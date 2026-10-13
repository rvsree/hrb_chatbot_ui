import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, resetAdminSecretCode } from "../api/client";
import DocLink from "../components/DocLink";
import { useIdentity } from "../context/IdentityContext";

// Phase 171 - reached either forced (right after a first admin login on
// the one-time seed code) or voluntarily (the admin dashboard's own
// "Change secret code" link). Both cases are the same form/flow - the
// backend itself only ever clears must_reset_secret_code, it doesn't
// distinguish "forced" from "voluntary".
export default function ResetSecretCodePage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmNewCode, setConfirmNewCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!identity) {
    navigate("/login");
    return null;
  }
  if (identity.role !== "admin") {
    navigate("/chat");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (newCode !== confirmNewCode) {
      setError("New code and confirmation don't match.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await resetAdminSecretCode(currentIdentity, currentCode, newCode);
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong reaching the backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>
          Change admin secret code <DocLink featureName="admin-secret-code" />
        </h1>
        <p className="dev-note">
          Set a new secret code for the admin login. You'll need the current code to confirm it's really you.
        </p>

        <label htmlFor="current-code">Current secret code</label>
        <input
          id="current-code"
          type="password"
          value={currentCode}
          onChange={(event) => setCurrentCode(event.target.value)}
          required
        />

        <label htmlFor="new-code">New secret code</label>
        <input
          id="new-code"
          type="password"
          value={newCode}
          onChange={(event) => setNewCode(event.target.value)}
          required
        />

        <label htmlFor="confirm-new-code">Confirm new secret code</label>
        <input
          id="confirm-new-code"
          type="password"
          value={confirmNewCode}
          onChange={(event) => setConfirmNewCode(event.target.value)}
          required
        />

        {error && <p className="error-banner">{error}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save new code"}
        </button>
      </form>
    </div>
  );
}
