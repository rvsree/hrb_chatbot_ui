import { useState } from "react";
import { ApiRequestError, deleteDocumentById } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentRecord } from "../types";

interface AdminDocumentModalProps {
  document: DocumentRecord;
  onClose: () => void;
  onDeleted: () => void;
}

// Phase 168 (round 3) - the admin dashboard's Documents tab row-click
// popup. All detail already came with the list response - no 2nd fetch
// needed, unlike the Conversations tab's own transcript popup.
export default function AdminDocumentModal({ document, onClose, onDeleted }: AdminDocumentModalProps) {
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
      await deleteDocumentById(identity, document.id);
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
        <h2>{document.filename}</h2>
        <p className="dev-note-inline">Document #{document.id}</p>

        <ul className="citation-list">
          <li>Status: {document.status}</li>
          {document.error_message && <li>Error: {document.error_message}</li>}
          <li>Chunks: {document.chunk_count}</li>
          <li>Size: {Math.round(document.file_size_bytes / 1024)} KB</li>
          <li>Embedding model: {document.embedding_model ?? "unknown"}</li>
          <li>Uploaded by: {document.uploaded_by ?? "unknown"}</li>
          <li>Uploaded: {new Date(document.created_at).toLocaleString()}</li>
          {document.last_indexed_at && <li>Last indexed: {new Date(document.last_indexed_at).toLocaleString()}</li>}
          {document.versioning_info && (
            <li>
              Version {document.versioning_info.document_version}
              {document.versioning_info.is_current ? " (current)" : " (superseded)"}
            </li>
          )}
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
