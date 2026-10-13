import { useState } from "react";
import { ApiRequestError, deleteFeedbackAdmin } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { FeedbackRecord } from "../types";

interface AdminFeedbackModalProps {
  entry: FeedbackRecord;
  onClose: () => void;
  onDeleted: () => void;
}

// Phase 168 (round 3) - the admin dashboard's Feedback tab row-click
// popup. All detail already came with the list response - no 2nd fetch
// needed, same as the Documents tab.
export default function AdminFeedbackModal({ entry, onClose, onDeleted }: AdminFeedbackModalProps) {
  const { identity } = useIdentity();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!identity) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteFeedbackAdmin(identity, entry.id);
      onDeleted();
    } catch (error) {
      setDeleteError(error instanceof ApiRequestError ? error.message : "Something went wrong reaching the backend.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>Feedback #{entry.id}</h2>
        <p className="dev-note-inline">
          Employee {entry.employee_id} · {entry.vote} · {new Date(entry.created_at).toLocaleString()}
        </p>

        <ul className="citation-list">
          <li>Question: {entry.question}</li>
          <li>Answer: {entry.answer}</li>
          {entry.reason_tags.length > 0 && <li>Reasons: {entry.reason_tags.join(", ")}</li>}
          {entry.notes && <li>Notes: {entry.notes}</li>}
        </ul>

        {deleteError && <p className="error-banner">{deleteError}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={isDeleting}>
            Close
          </button>
          <button type="button" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
