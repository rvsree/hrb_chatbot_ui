import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, deleteDocumentById, getHealth, listDocuments, rechunkDocument, uploadDocuments } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentRecord } from "../types";
import { formatElapsed, statusLabel } from "../utils/documentStatus";

function elapsedMs(doc: DocumentRecord): number {
  const end = doc.status === "indexed" && doc.last_indexed_at ? doc.last_indexed_at : doc.updated_at;
  return new Date(end).getTime() - new Date(doc.created_at).getTime();
}

const TERMINAL_STATUSES = new Set(["indexed", "failed"]);
const POLL_INTERVAL_MS = 2500;

// Matches text_chunker.py's CHUNKING_STRATEGIES - "semantic" costs a real
// embedding call per sentence, included anyway so the choice isn't hidden,
// just not the default.
const CHUNKING_STRATEGIES = ["recursive", "fixed", "markdown", "html", "none", "document_structure", "semantic"];

// hrb-chatbot-kb-uploads/us-east-1 - RAG-ROADMAP.md Phase 88. The bucket
// blocks all public access, so a direct S3 object URL would just 403 - the
// AWS console deep link is the one that's actually openable, for whoever's
// logged into this AWS account (this project's own admin, day to day).
function s3ConsoleLink(filePath: string): string | null {
  if (!filePath.startsWith("s3://")) {
    return null;
  }
  const withoutScheme = filePath.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }
  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);
  return `https://s3.console.aws.amazon.com/s3/object/${bucket}?region=us-east-1&prefix=${encodeURIComponent(key)}`;
}

export default function DocumentsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [activeEmbeddingModel, setActiveEmbeddingModel] = useState<string | null>(null);
  const [rechunkingId, setRechunkingId] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<Record<string, string>>({});
  const [elapsedTarget, setElapsedTarget] = useState<DocumentRecord | null>(null);
  const [errorTarget, setErrorTarget] = useState<DocumentRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Keeps selectedIds in sync with what's actually still in the grid -
  // without this, a deleted or no-longer-polled document stays "selected"
  // forever, inflating the count shown above the table.
  useEffect(() => {
    setSelectedIds((current) => {
      const stillPresent = new Set(documents.map((doc) => doc.id));
      const pruned = new Set([...current].filter((id) => stillPresent.has(id)));
      return pruned.size === current.size ? current : pruned;
    });
  }, [documents]);

  useEffect(() => {
    if (!identity || identity.role !== "hr_support") {
      return;
    }
    refresh(identity.employee_id, identity.full_name, identity.role);
    // Best-effort - the mismatch indicator just doesn't show if this fails.
    getHealth()
      .then((health) => setActiveEmbeddingModel(health.embedding_model))
      .catch(() => {});
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

  function toggleSelected(documentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => (current.size === documents.length ? new Set() : new Set(documents.map((doc) => doc.id))));
  }

  async function handleBulkDelete() {
    const targets = documents.filter((doc) => selectedIds.has(doc.id));
    if (targets.length === 0) {
      return;
    }
    const names = targets.map((doc) => doc.filename).join(", ");
    if (!window.confirm(`Delete ${targets.length} document(s)? This removes them from the vector store and database.\n\n${names}`)) {
      return;
    }
    setIsBulkDeleting(true);
    setError(null);
    const failures: string[] = [];
    await Promise.all(
      targets.map(async (doc) => {
        try {
          await deleteDocumentById(currentIdentity, doc.id);
        } catch {
          failures.push(doc.filename);
        }
      }),
    );
    setDocuments((current) => current.filter((doc) => !selectedIds.has(doc.id) || failures.includes(doc.filename)));
    setSelectedIds(new Set());
    setIsBulkDeleting(false);
    if (failures.length > 0) {
      setError(`Couldn't delete: ${failures.join(", ")}`);
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

  async function handleStrategySelected(documentId: string, filename: string, chunkingStrategy: string) {
    // Confirmation fires the moment a strategy is picked - no separate
    // "apply" step. Cancelling resets the dropdown back to its placeholder
    // so it never looks like a change was silently applied.
    if (!window.confirm(`Re-chunk "${filename}" with strategy "${chunkingStrategy}"? This re-embeds the whole document.`)) {
      setSelectedStrategy((current) => ({ ...current, [documentId]: "" }));
      return;
    }
    setSelectedStrategy((current) => ({ ...current, [documentId]: chunkingStrategy }));
    setRechunkingId(documentId);
    setError(null);
    try {
      await rechunkDocument(currentIdentity, documentId, chunkingStrategy);
      await refresh(currentIdentity.employee_id, currentIdentity.full_name, currentIdentity.role);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`Couldn't re-chunk "${filename}": ${err.message} (${err.code})`);
      } else {
        setError(`Couldn't re-chunk "${filename}" - something went wrong reaching the backend.`);
      }
    } finally {
      setRechunkingId(null);
      setSelectedStrategy((current) => ({ ...current, [documentId]: "" }));
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
          <>
          <div className="documents-bulk-actions">
            <span className="dev-note-inline">{selectedIds.size} selected</span>
            <button type="button" disabled={selectedIds.size === 0 || isBulkDeleting} onClick={handleBulkDelete}>
              {isBulkDeleting ? "Deleting..." : "Delete selected"}
            </button>
          </div>
          <div className="documents-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={documents.length > 0 && selectedIds.size === documents.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all documents"
                  />
                </th>
                <th>Filename</th>
                <th>Source</th>
                <th>Status</th>
                <th>Elapsed</th>
                <th>Chunks</th>
                <th>Chunking Strategy</th>
                <th>Chunk size / overlap</th>
                <th>Embedding Model</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelected(doc.id)}
                      aria-label={`Select ${doc.filename}`}
                    />
                  </td>
                  <td>
                    {doc.filename}
                    {doc.versioning_info && !doc.versioning_info.is_current && <span className="dev-note-inline"> (superseded)</span>}
                  </td>
                  <td>
                    {s3ConsoleLink(doc.file_path) ? (
                      <a href={s3ConsoleLink(doc.file_path)!} target="_blank" rel="noreferrer">
                        S3 object
                      </a>
                    ) : (
                      <span className="dev-note-inline" title={doc.file_path}>
                        local disk
                      </span>
                    )}
                  </td>
                  <td>
                    {doc.status === "failed" ? (
                      <button
                        type="button"
                        className="status-badge status-failed status-badge-button"
                        title={doc.error_message ?? undefined}
                        onClick={() => setErrorTarget(doc)}
                      >
                        {statusLabel(doc.status, doc.error_message)}
                      </button>
                    ) : (
                      <span className={`status-badge status-${doc.status}`}>{statusLabel(doc.status, doc.error_message)}</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="link-button" onClick={() => setElapsedTarget(doc)}>
                      {formatElapsed(elapsedMs(doc))}
                    </button>
                  </td>
                  <td>{doc.chunk_count}</td>
                  <td>
                    <select
                      value={selectedStrategy[doc.id] ?? doc.chunk_info?.chunking_strategy ?? ""}
                      onChange={(event) => {
                        const chosen = event.target.value;
                        if (chosen && chosen !== doc.chunk_info?.chunking_strategy) {
                          handleStrategySelected(doc.id, doc.filename, chosen);
                        }
                      }}
                      disabled={rechunkingId === doc.id}
                    >
                      {!doc.chunk_info?.chunking_strategy && <option value="">—</option>}
                      {CHUNKING_STRATEGIES.map((strategy) => (
                        <option key={strategy} value={strategy}>
                          {strategy}
                        </option>
                      ))}
                    </select>
                    {rechunkingId === doc.id && <span className="dev-note-inline"> re-chunking...</span>}
                  </td>
                  <td>
                    {doc.chunk_info?.chunk_size != null
                      ? `${doc.chunk_info.chunk_size} / ${doc.chunk_info.chunk_overlap}`
                      : "—"}
                  </td>
                  <td>
                    {doc.embedding_model ?? "—"}
                    {doc.embedding_model &&
                      activeEmbeddingModel &&
                      doc.embedding_model !== activeEmbeddingModel && (
                        <span
                          className="knowledge-source-failed"
                          title={`Indexed with ${doc.embedding_model}, but queries currently embed with ${activeEmbeddingModel} - retrieval against this document may be unreliable.`}
                        >
                          {" "}
                          ⚠ mismatch
                        </span>
                      )}
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
          </>
        )}
      </div>

      {elapsedTarget && (
        <div className="modal-overlay" onClick={() => setElapsedTarget(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>Timing - {elapsedTarget.filename}</h2>
            <ul className="citation-list">
              <li>Created: {new Date(elapsedTarget.created_at).toLocaleString()}</li>
              <li>
                Last indexed:{" "}
                {elapsedTarget.last_indexed_at ? new Date(elapsedTarget.last_indexed_at).toLocaleString() : "not yet indexed"}
              </li>
              <li>Last updated: {new Date(elapsedTarget.updated_at).toLocaleString()}</li>
              <li>Elapsed: {formatElapsed(elapsedMs(elapsedTarget))}</li>
            </ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setElapsedTarget(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {errorTarget && (
        <div className="modal-overlay" onClick={() => setErrorTarget(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>Error - {errorTarget.filename}</h2>
            <pre className="llm-context-pre">{errorTarget.error_message ?? "No error detail recorded."}</pre>
            <div className="modal-actions">
              <button type="button" onClick={() => setErrorTarget(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
