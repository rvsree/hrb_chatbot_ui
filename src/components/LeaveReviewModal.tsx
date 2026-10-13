import { useState } from "react";
import {
  ApiRequestError,
  deleteLeaveRequestAdmin,
  getLeaveDocumentDownloadUrl,
  resolveUnpaidLeaveRequest,
} from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import { LEAVE_TYPE_LABELS, type HrLeaveRequestSummary, type LeaveTypeCode } from "../types";

interface LeaveReviewModalProps {
  request: HrLeaveRequestSummary;
  onClose: () => void;
  onResolved: () => void;
}

// Phase 168 (round 2) - the HR specialist grid's own row-click popup,
// mirroring the employee side's UnpaidLeaveModal shape: a PENDING request
// shows the decision form (today's Approve/Reject, moved here from the
// old full-page inline version); an already-resolved one shows the real
// outcome read-only - the same "status/comments on open" pattern the
// employee popup already uses for its own "Your requests" list.
// Round 3 - also used by the admin dashboard's own Leave Requests tab:
// an admin viewer sees the same read-only detail every resolved request
// already shows, plus a Delete button, regardless of status - admins
// manage/clean up data, they don't make HR decisions, so no resolve form
// is ever shown for them even on a PENDING row.
export default function LeaveReviewModal({ request, onClose, onResolved }: LeaveReviewModalProps) {
  const { identity } = useIdentity();
  const [responseText, setResponseText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isOpeningDocument, setIsOpeningDocument] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin = identity?.role === "admin";
  const isPending = request.status === "PENDING";

  async function handleDelete() {
    if (!identity) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteLeaveRequestAdmin(identity, request.hitl_request_context_id);
      onResolved();
    } catch (error) {
      setDeleteError(error instanceof ApiRequestError ? error.message : "Something went wrong reaching the backend.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDecision(decision: "APPROVED" | "REJECTED") {
    if (!identity) {
      return;
    }
    if (!responseText.trim()) {
      setSubmitError("Add a short note explaining the decision before submitting.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await resolveUnpaidLeaveRequest(identity, request.hitl_request_context_id, decision, responseText.trim());
      onResolved();
    } catch (error) {
      setSubmitError(error instanceof ApiRequestError ? error.message : "Something went wrong reaching the backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOpenDocument() {
    if (!identity) {
      return;
    }
    setIsOpeningDocument(true);
    setDocumentError(null);
    try {
      const result = await getLeaveDocumentDownloadUrl(identity, request.request_id);
      window.open(result.download_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setDocumentError(
        error instanceof ApiRequestError && error.code === "LEAVE_DOCUMENT_NOT_FOUND"
          ? "No document attached to this request."
          : "Could not open the document.",
      );
    } finally {
      setIsOpeningDocument(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>
          Request #{request.hitl_request_context_id} ·{" "}
          {LEAVE_TYPE_LABELS[request.leave_type as LeaveTypeCode] ?? request.leave_type}
        </h2>
        <p className="dev-note-inline">
          Employee {request.employee_name ?? "unknown"} ({request.employee_id ?? "unknown"})
        </p>

        {request.review_brief && (
          <div className="panel panel-info">
            <span className="panel-eyebrow">Review brief (generated)</span>
            <p className="dev-note-inline">{request.review_brief}</p>
          </div>
        )}

        <ul className="citation-list">
          <li>
            Dates: {request.start_date} to {request.end_date} ({request.days} day(s))
          </li>
          <li>Purpose: {request.purpose}</li>
          <li>Submitted: {request.created_at ? new Date(request.created_at).toLocaleString() : "unknown"}</li>
        </ul>

        <button type="button" className="link-button" onClick={handleOpenDocument} disabled={isOpeningDocument}>
          {isOpeningDocument ? "Opening..." : "Open document"}
        </button>
        {documentError && <p className="dev-note-inline">{documentError}</p>}

        {isPending && !isAdmin ? (
          <>
            <label htmlFor="leave-review-response">Decision note</label>
            <textarea
              id="leave-review-response"
              rows={3}
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder="Why are you approving or rejecting this request?"
              disabled={isSubmitting}
            />
            {submitError && <p className="error-banner">{submitError}</p>}

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </button>
              <button type="button" className="secondary" onClick={() => handleDecision("REJECTED")} disabled={isSubmitting}>
                Reject
              </button>
              <button type="button" onClick={() => handleDecision("APPROVED")} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Approve"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="panel panel-info" style={{ marginTop: 10 }}>
              <span className="panel-eyebrow">
                {request.status}
                {request.decision && ` · ${request.decision}`}
              </span>
              {request.hr_comments && (
                <p className="dev-note-inline">
                  HR comments{request.hr_specialist_name ? ` from ${request.hr_specialist_name}` : ""}:{" "}
                  {request.hr_comments}
                </p>
              )}
              {request.responded_at && (
                <p className="dev-note-inline">Reviewed: {new Date(request.responded_at).toLocaleString()}</p>
              )}
            </div>
            {deleteError && <p className="error-banner">{deleteError}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={isDeleting}>
                Close
              </button>
              {isAdmin && (
                <button type="button" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
