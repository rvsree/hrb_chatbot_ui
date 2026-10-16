import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, listFaqSubmissions, restructureFaqSubmission, reviewFaqSubmission } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { FaqSubmissionRecord } from "../types";

// Phase 186 - the review queue for employee-submitted FAQ questions.
// HR Support and both admin tiers can review - same reasoning as leave
// approvals: HR reviews content, admin oversees everything.
export default function FaqReviewPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<FaqSubmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FaqSubmissionRecord | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [draftStatus, setDraftStatus] = useState("approved");
  const [draftPublished, setDraftPublished] = useState(false);
  const [isRestructuring, setIsRestructuring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || (identity.role !== "hr_support" && identity.role !== "admin" && identity.role !== "employee_admin")) {
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

  if (currentIdentity.role !== "hr_support" && currentIdentity.role !== "admin" && currentIdentity.role !== "employee_admin") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>FAQ submissions</h1>
          <p>Only HR Support and Admin can review FAQ submissions - the backend rejects any other role.</p>
          <p>
            <Link to="/chat">Back to chat</Link>
          </p>
        </div>
      </div>
    );
  }

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listFaqSubmissions(currentIdentity);
      setSubmissions(result.submissions);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong reaching the backend.");
    } finally {
      setIsLoading(false);
    }
  }

  function openSubmission(submission: FaqSubmissionRecord) {
    setSelected(submission);
    setDraftAnswer(submission.final_answer ?? submission.external_llm_answer ?? "");
    setDraftStatus(submission.internal_review_status === "pending" ? "approved" : submission.internal_review_status);
    setDraftPublished(submission.published);
    setActionError(null);
  }

  async function handleRestructure() {
    if (!selected) {
      return;
    }
    setIsRestructuring(true);
    setActionError(null);
    try {
      const updated = await restructureFaqSubmission(currentIdentity, selected.id);
      setSelected(updated);
      setDraftAnswer(updated.final_answer ?? "");
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Could not restructure this answer.");
    } finally {
      setIsRestructuring(false);
    }
  }

  async function handleSaveReview() {
    if (!selected) {
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await reviewFaqSubmission(currentIdentity, selected.id, draftStatus, draftAnswer, draftPublished);
      setSelected(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Could not save this review.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>FAQ submissions</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
        </p>
        <p className="dev-note">Click a row to review, restructure with Claude, edit, and publish.</p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}
        {!isLoading && submissions.length === 0 && !error && <p>No FAQ submissions yet.</p>}

        {submissions.length > 0 && (
          <div className="documents-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Status</th>
                  <th>Published</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id} onClick={() => openSubmission(submission)} style={{ cursor: "pointer" }}>
                    <td>{submission.query}</td>
                    <td>{submission.internal_review_status}</td>
                    <td>{submission.published ? "Yes" : "No"}</td>
                    <td>{new Date(submission.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{selected.query}</h2>
            <p className="dev-note-inline">Submitted by {selected.employee_id}</p>
            <ul className="citation-list">
              <li>First-pass answer: {selected.external_llm_answer ?? "(none - the LLM call failed at submit time)"}</li>
            </ul>

            <label>
              Final answer
              <textarea value={draftAnswer} onChange={(event) => setDraftAnswer(event.target.value)} rows={5} style={{ width: "100%" }} />
            </label>

            <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
              <button type="button" className="secondary" onClick={handleRestructure} disabled={isRestructuring || !selected.external_llm_answer}>
                {isRestructuring ? "Asking Claude..." : "Restructure with Claude"}
              </button>
            </div>

            <label>
              Review status
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>

            <label className="checkbox-label">
              <input type="checkbox" checked={draftPublished} onChange={(event) => setDraftPublished(event.target.checked)} />
              Published (visible to all employees)
            </label>

            {actionError && <p className="error-banner">{actionError}</p>}

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setSelected(null)} disabled={isSaving}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveReview} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
