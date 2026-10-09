import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, deleteDocumentById, listDocuments, uploadDocuments } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentRecord } from "../types";

const TERMINAL_STATUSES = new Set(["indexed", "failed"]);
const POLL_INTERVAL_MS = 2500;

export default function DocumentsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || identity.role !== "hr_support") {
      return;
    }
    refresh(identity.employee_id, identity.full_name, identity.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Polls while any document is still mid-pipeline (chunking/embedding/
  // pending_upload) - stops itself once every document reaches a terminal
  // state, so this doesn't poll forever on an otherwise-idle page.
  useEffect(() => {
    if (!identity || identity.role !== "hr_support") {
      return;
    }
    const hasInFlightDocument = documents.some((doc) => !TERMINAL_STATUSES.has(doc.status));
    if (!hasInFlightDocument) {
      return;
    }
    const intervalId = window.setInterval(() => {
      refresh(identity.employee_id, identity.full_name, identity.role);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, documents]);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  if (identity.role !== "hr_support") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Indexed documents</h1>
          <p>Only HR Support can view or delete indexed documents.</p>
          <Link to="/chat">Back to chat</Link>
        </div>
      </div>
    );
  }

  async function refresh(employeeId: string, fullName: string, role: string) {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listDocuments({ employee_id: employeeId, full_name: fullName, role: role as "hr_support" });
      setDocuments(response.documents);
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

  async function handleDelete(documentId: string, filename: string) {
    if (!window.confirm(`Delete "${filename}"? This removes it from the vector store and database.`)) {
      return;
    }
    try {
      await deleteDocumentById(currentIdentity, documentId);
      setDocuments((current) => current.filter((doc) => doc.id !== documentId));
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`Couldn't delete "${filename}": ${err.message} (${err.code})`);
      } else {
        setError(`Couldn't delete "${filename}" - something went wrong reaching the backend.`);
      }
    }
  }

  async function handleReplace(documentId: string, filename: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setReplacingId(documentId);
    setError(null);
    try {
      // supersedes_document_id marks the old version not-current and
      // indexes this file as the new current one - existing backend
      // feature (documents_service.py), not a new upload path.
      await uploadDocuments(currentIdentity, [file], documentId);
      await refresh(currentIdentity.employee_id, currentIdentity.full_name, currentIdentity.role);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`Couldn't replace "${filename}": ${err.message} (${err.code})`);
      } else {
        setError(`Couldn't replace "${filename}" - something went wrong reaching the backend.`);
      }
    } finally {
      setReplacingId(null);
    }
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>Indexed documents</h1>
        <p>
          <Link to="/chat">Back to chat</Link> · <Link to="/upload">Upload more</Link> ·{" "}
          <Link to="/feedback">View feedback</Link>
        </p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}

        {!isLoading && documents.length === 0 && !error && <p>No documents indexed yet.</p>}

        {documents.length > 0 && (
          <div className="documents-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Chunk size / overlap</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    {doc.filename}
                    {doc.versioning_info && !doc.versioning_info.is_current && <span className="dev-note-inline"> (superseded)</span>}
                  </td>
                  <td>
                    <span className={`status-badge status-${doc.status}`}>{doc.status}</span>
                  </td>
                  <td>{doc.chunk_count}</td>
                  <td>
                    {doc.chunk_info?.chunk_size != null
                      ? `${doc.chunk_info.chunk_size} / ${doc.chunk_info.chunk_overlap}` +
                        (doc.chunk_info.chunking_strategy ? ` (${doc.chunk_info.chunking_strategy})` : "")
                      : "—"}
                  </td>
                  <td>{(doc.file_size_bytes / 1024).toFixed(0)} KB</td>
                  <td>
                    <div className="documents-table-actions">
                      <label className="link-button" style={{ cursor: "pointer" }}>
                        {replacingId === doc.id ? "replacing..." : "replace"}
                        <input
                          type="file"
                          accept=".pdf"
                          hidden
                          disabled={replacingId !== null}
                          onChange={(event) => handleReplace(doc.id, doc.filename, event)}
                        />
                      </label>
                      <button type="button" className="link-button" onClick={() => handleDelete(doc.id, doc.filename)}>
                        delete
                      </button>
                    </div>
                  </td>
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
