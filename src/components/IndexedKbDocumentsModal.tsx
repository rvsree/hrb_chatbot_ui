import { useEffect, useState } from "react";
import { ApiRequestError, listDocuments } from "../api/client";
import type { DocumentRecord, UserProfile } from "../types";
import { statusLabel } from "../utils/documentStatus";

// Phase 39 - a read-only view of the same documents HR Support manages on
// DocumentsPage.tsx, open to every role (hrb_chatbot_service's own Phase
// 291 widened the underlying GET route for exactly this). Deliberately a
// new, small component rather than reusing DocumentsPage.tsx directly -
// that page's upload/reindex/rechunk/delete logic (752 lines) is real
// regression surface this view has no need to carry.
interface IndexedKbDocumentsModalProps {
  onClose: () => void;
  userProfile: UserProfile;
}

export default function IndexedKbDocumentsModal({ onClose, userProfile }: IndexedKbDocumentsModalProps) {
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments(userProfile)
      .then((response) => {
        if (!cancelled) {
          setDocuments(response.documents);
        }
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setError(caught instanceof ApiRequestError ? caught.message : "Could not load the document list.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on open only
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card indexed-kb-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Indexed KB Documents</h2>
        <p className="dev-note">
          Every document the chatbot can currently answer from - read-only. Uploading, reindexing, and deleting stay
          limited to the HR Support role.
        </p>

        {error && <p className="leave-form-error">{error}</p>}
        {!error && !documents && <p>Loading...</p>}
        {!error && documents && documents.length === 0 && <p>No documents have been indexed yet.</p>}
        {!error && documents && documents.length > 0 && (
          <div className="indexed-kb-table-wrapper">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Chunks</th>
                  <th>Embedding Model</th>
                  <th>Version</th>
                  <th>Size</th>
                  <th>Last Indexed</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.filename}</td>
                    <td>
                      <span className={`status-badge status-${doc.status}`}>{statusLabel(doc.status, doc.error_message)}</span>
                    </td>
                    <td>{doc.chunk_count}</td>
                    <td>{doc.embedding_model ?? "—"}</td>
                    <td>
                      v{doc.versioning_info?.document_version ?? 1}
                      {doc.versioning_info && !doc.versioning_info.is_current ? " (superseded)" : ""}
                    </td>
                    <td>{(doc.file_size_bytes / 1024).toFixed(0)} KB</td>
                    <td>{doc.last_indexed_at ? new Date(doc.last_indexed_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Phase 41 - same public README link ChatbotFeaturesModal's own
            "Grow the knowledge base" capability already uses (anchor
            hand-verified against GitHub's slug rules there) - not the
            admin-only DocLink/S3 doc viewer, which stays out of scope for
            this read-only, every-role view. */}
        <p className="dev-note-inline">
          <a
            href="https://github.com/rvsree/hrb_chatbot_service/blob/master/README.md#how-ingestion-actually-works"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more about how documents get uploaded and indexed →
          </a>
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
