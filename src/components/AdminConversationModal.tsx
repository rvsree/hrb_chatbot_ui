import { useEffect, useState } from "react";
import { ApiRequestError, deleteConversationAdmin, getConversationTurnsAdmin } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { AdminConversationSummary, ConversationTurnRecord } from "../types";

interface AdminConversationModalProps {
  conversation: AdminConversationSummary;
  onClose: () => void;
  onDeleted: () => void;
}

// Phase 168 (round 3) - the admin dashboard's Conversations tab row-click
// popup. Unlike the other 3 tabs, the grid row doesn't carry enough detail
// on its own (just a title + dates) - the real reason to open this popup
// is to actually read the conversation before deciding whether it's safe
// to delete, so it fetches the full transcript on open.
export default function AdminConversationModal({ conversation, onClose, onDeleted }: AdminConversationModalProps) {
  const { identity } = useIdentity();
  const [turns, setTurns] = useState<ConversationTurnRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      return;
    }
    getConversationTurnsAdmin(identity, conversation.conversation_id)
      .then((response) => setTurns(response.turns))
      .catch((error) => {
        setLoadError(error instanceof ApiRequestError ? error.message : "Could not load the transcript.");
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.conversation_id]);

  async function handleDelete() {
    if (!identity) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversationAdmin(identity, conversation.conversation_id);
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
        <h2>{conversation.title}</h2>
        <p className="dev-note-inline">
          Employee {conversation.employee_id ?? "unknown"} · Started{" "}
          {new Date(conversation.started_at).toLocaleString()}
        </p>

        {isLoading && <p>Loading transcript...</p>}
        {loadError && <p className="error-banner">{loadError}</p>}

        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          {turns.map((turn, index) => (
            <div key={index} className="panel panel-info" style={{ marginTop: 8 }}>
              <span className="panel-eyebrow">{turn.role === "human" ? "Employee" : "Assistant"}</span>
              <p className="dev-note-inline">{turn.content}</p>
            </div>
          ))}
        </div>

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
