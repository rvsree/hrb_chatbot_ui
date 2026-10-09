import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, listFeedback } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import ThumbIcon from "../components/ThumbIcon";
import type { FeedbackRecord } from "../types";

export default function ViewFeedbackPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listFeedback(currentIdentity);
      setFeedback(response.feedback);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.message} (${err.code})`);
      } else {
        setError("Something went wrong reaching the backend.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>Feedback</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
          {currentIdentity.role === "hr_support" && (
            <>
              {" "}
              · <Link to="/upload">Upload more</Link> · <Link to="/documents">Manage documents</Link>
            </>
          )}
        </p>
        <p className="dev-note">
          {currentIdentity.role === "hr_support"
            ? "Showing feedback from every employee."
            : "Showing your own submitted feedback."}
        </p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}
        {!isLoading && feedback.length === 0 && !error && <p>No feedback submitted yet.</p>}

        {feedback.length > 0 && (
          <div className="documents-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                {currentIdentity.role === "hr_support" && <th>Employee</th>}
                <th>Vote</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Reasons</th>
                <th>Notes</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((entry) => (
                <tr key={entry.id}>
                  {currentIdentity.role === "hr_support" && <td>{entry.employee_id}</td>}
                  <td>
                    <ThumbIcon direction={entry.vote === "helpful" ? "up" : "down"} />
                  </td>
                  <td>{entry.question}</td>
                  <td>{entry.answer}</td>
                  <td>{entry.reason_tags.join(", ") || "—"}</td>
                  <td>{entry.notes || "—"}</td>
                  <td>{new Date(entry.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
