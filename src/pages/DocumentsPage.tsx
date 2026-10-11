import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, deleteDocumentById, getHealth, listDocuments, rechunkDocument, uploadDocuments } from "../api/client";
import ConfirmModal from "../components/ConfirmModal";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentRecord } from "../types";
import { formatElapsed, statusLabel } from "../utils/documentStatus";

function strategyLabel(strategy: string): string {
  return strategy
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

// Phase 156 - mirrors models/documents.py's ChunkInfoInput bounds, so a bad
// value is rejected by the input itself, not just the backend's 422.
const MIN_CHUNK_SIZE = 200;
const MAX_CHUNK_SIZE = 4000;
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 150;

// Phase 155 - one concise blurb per strategy for the "?" help popover,
// reused for whichever two strategies are in play (current/new) rather than
// a hand-written entry per pair. Matches text_chunker.py's real post-Phase-154
// behavior: every strategy now respects chunk_size/chunk_overlap, either as
// a direct split target (recursive/fixed/document_structure) or as a safety
// cap on top of its own primary splitting (semantic/markdown/html/none).
const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  recursive: "Splits by paragraph/sentence into chunks targeting your chosen size. Predictable, but a boundary can split a fact across two chunks.",
  fixed: "Splits on a single separator into chunks targeting your chosen size. Simpler/faster than Recursive, more likely to cut mid-sentence.",
  semantic:
    "Uses AI to split where topics shift, not at a fixed size - then caps any resulting chunk at your chosen size so no single chunk gets too large.",
  markdown:
    "Splits on markdown headers (#, ##, ###), capped at your chosen size. Most PDFs have no markdown headers, so this often behaves like one big chunk.",
  html: "Splits on HTML heading tags (h1/h2/h3), capped at your chosen size. Same caveat as Markdown - most PDFs have no HTML tags either.",
  none: "No deliberate splitting - the whole document is one chunk, capped at your chosen size only as a safety net for very large documents.",
  document_structure: "Splits by this document's own \"Section N\" / \"N.N Subtitle\" headings, each capped at your chosen size.",
};

// Chunk-count direction + retrieval-quality tradeoff for the new strategy,
// combined into one sentence in the "Expected impact" section below.
const STRATEGY_IMPACT: Record<string, { tendency: string; retrieval: string }> = {
  recursive: {
    tendency: "many, similarly-sized chunks",
    retrieval: "balanced precision and completeness, but a boundary can split a fact across chunks",
  },
  fixed: {
    tendency: "many, similarly-sized chunks",
    retrieval: "similar to Recursive, with a slightly higher chance of a fact being cut mid-sentence",
  },
  semantic: {
    tendency: "fewer, topic-grouped chunks",
    retrieval: "better completeness on broad questions, but possibly lower precision on narrow fact lookups (a detail can get buried in a larger chunk)",
  },
  markdown: {
    tendency: "depends entirely on markdown headers in the document - often very few chunks for a PDF",
    retrieval: "can hurt precision badly if the document has no real markdown headers - verify this fits before relying on it",
  },
  html: {
    tendency: "depends entirely on HTML headings in the document - often very few chunks for a PDF",
    retrieval: "same risk as Markdown - low precision if the document has no real HTML headings",
  },
  none: {
    tendency: "exactly 1 chunk (or a few, only if the document is larger than your chosen size)",
    retrieval: "best completeness since nothing is pre-split, but no targeted retrieval at all - every query returns the same chunk(s)",
  },
  document_structure: {
    tendency: "chunk count follows the document's real sections",
    retrieval: "better completeness for section-level questions, when real headings exist",
  },
};

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
  // Phase 143: replaces window.confirm() for single/bulk document delete -
  // same reported "browser warning" look as the chunking-strategy one, but
  // these use the existing centered .modal-overlay/.modal-card pattern
  // instead of an anchored popover, since bulk delete has no single row to
  // anchor to.
  const [deleteTarget, setDeleteTarget] = useState<{ documentId: string; filename: string } | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // Phase 142: replaces window.confirm() for the chunking-strategy change -
  // a native browser dialog can't be restyled, repositioned, or given a
  // help control, and reads as an unstyled "browser warning" (reported).
  // This renders inline inside that row's own table cell instead of a
  // full-page overlay, so it visually anchors to where the user clicked.
  const [confirmTarget, setConfirmTarget] = useState<{
    documentId: string;
    filename: string;
    chunkingStrategy: string;
    chunkSize: number;
    chunkOverlap: number;
  } | null>(null);
  const [showChunkingHelp, setShowChunkingHelp] = useState(false);
  const [showChunkSizeHelp, setShowChunkSizeHelp] = useState(false);
  // Phase 142 - real bug: the periodic poll (every POLL_INTERVAL_MS) and the
  // explicit refresh() right after a rechunk completes could both be
  // in-flight at once; whichever HTTP response happened to arrive LAST won,
  // even if it was for the OLDER (stale) request - e.g. a poll started just
  // before a rechunk committed could resolve after the rechunk's own
  // refresh and overwrite the correct new chunking_strategy with the stale
  // pre-rechunk one, which is exactly the "reverts after a few seconds" bug
  // reported. This ref sequences refresh() calls so only the response to
  // the MOST RECENTLY started request is ever applied to state.
  const latestRefreshId = useRef(0);

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
    const requestId = ++latestRefreshId.current;
    setIsLoading(true);
    setError(null);
    try {
      const response = await listDocuments({ employee_id: employeeId, full_name: fullName, role: role as "hr_support" });
      // A newer refresh() started while this one was in flight - its
      // response is stale even though it arrived "last" in wall-clock
      // time; drop it rather than overwrite the newer data.
      if (requestId !== latestRefreshId.current) {
        return;
      }
      setDocuments(response.documents);
    } catch (err) {
      if (requestId !== latestRefreshId.current) {
        return;
      }
      if (err instanceof ApiRequestError) {
        setError(`${err.message} (${err.code})`);
      } else {
        setError("Something went wrong reaching the backend.");
      }
    } finally {
      if (requestId === latestRefreshId.current) {
        setIsLoading(false);
      }
    }
  }

  function handleDelete(documentId: string, filename: string) {
    setDeleteTarget({ documentId, filename });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) {
      return;
    }
    const { documentId, filename } = deleteTarget;
    setDeleteTarget(null);
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

  function handleBulkDelete() {
    if (selectedIds.size === 0) {
      return;
    }
    setShowBulkDeleteConfirm(true);
  }

  async function handleConfirmBulkDelete() {
    setShowBulkDeleteConfirm(false);
    const targets = documents.filter((doc) => selectedIds.has(doc.id));
    if (targets.length === 0) {
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

  function handleStrategySelected(
    documentId: string,
    filename: string,
    chunkingStrategy: string,
    currentChunkSize: number | null | undefined,
    currentChunkOverlap: number | null | undefined,
  ) {
    // Phase 142: just opens the inline confirmation popover now - the
    // actual rechunk only fires from handleConfirmRechunk below, once the
    // user clicks "Apply Chunking Strategy" in it. Phase 156: pre-fills
    // chunk size/overlap from the document's current values (editable from
    // here, not forced) rather than always falling back to the server's
    // own defaults.
    setConfirmTarget({
      documentId,
      filename,
      chunkingStrategy,
      chunkSize: currentChunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: currentChunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    });
  }

  function handleEditSizeClicked(doc: DocumentRecord) {
    // Phase 156 - lets chunk size/overlap be changed on their own, keeping
    // the current strategy, instead of only ever as a side effect of
    // picking a new strategy from the dropdown.
    const currentStrategy = doc.chunk_info?.chunking_strategy ?? "recursive";
    setConfirmTarget({
      documentId: doc.id,
      filename: doc.filename,
      chunkingStrategy: currentStrategy,
      chunkSize: doc.chunk_info?.chunk_size ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: doc.chunk_info?.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP,
    });
  }

  function handleCancelRechunk() {
    if (confirmTarget) {
      // Cancelling resets the dropdown back to its placeholder so it
      // never looks like a change was silently applied.
      setSelectedStrategy((current) => ({ ...current, [confirmTarget.documentId]: "" }));
    }
    setConfirmTarget(null);
    setShowChunkingHelp(false);
  }

  async function handleConfirmRechunk() {
    if (!confirmTarget) {
      return;
    }
    const { documentId, filename, chunkingStrategy, chunkSize, chunkOverlap } = confirmTarget;
    setConfirmTarget(null);
    setShowChunkingHelp(false);
    setSelectedStrategy((current) => ({ ...current, [documentId]: chunkingStrategy }));
    setRechunkingId(documentId);
    setError(null);
    try {
      await rechunkDocument(currentIdentity, documentId, chunkingStrategy, chunkSize, chunkOverlap);
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
                <th className="chunk-size-header">
                  <span className="chunk-size-header-row">
                    Chunk size / overlap
                    <button
                      type="button"
                      className="chunking-help-button"
                      aria-label="What does changing chunk size/overlap do?"
                      title="What does changing chunk size/overlap do?"
                      onClick={() => setShowChunkSizeHelp((current) => !current)}
                    >
                      ?
                    </button>
                  </span>
                  {showChunkSizeHelp && (
                    <div className="chunking-help-popover chunk-size-help-popover">
                      <p>
                        <strong>Chunk size</strong> is the target length (in characters) for each piece of the
                        document. Smaller chunks are more precise for narrow fact lookups, but can lose surrounding
                        context; larger chunks keep more context together, but a too-large chunk dilutes its own
                        embedding and can hurt retrieval precision (the same issue re-indexing a document is meant to
                        fix - see the "?" in Chunking Strategy).
                      </p>
                      <p>
                        <strong>Overlap</strong> repeats a few characters between consecutive chunks, so a sentence
                        that falls right on a boundary still appears whole in at least one chunk. Typically 10-20% of
                        chunk size - too little risks losing a boundary fact, too much just duplicates content across
                        chunks.
                      </p>
                    </div>
                  )}
                </th>
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
                  <td className="chunking-strategy-cell">
                    <select
                      // "" means "no override, show the real stored value" (set by
                      // handleCancelRechunk/handleConfirmRechunk's finally block) -
                      // must use || here, not ??, since "" is falsy but not
                      // null/undefined and would otherwise short-circuit past the
                      // real doc.chunk_info?.chunking_strategy fallback.
                      value={selectedStrategy[doc.id] || doc.chunk_info?.chunking_strategy || ""}
                      onChange={(event) => {
                        const chosen = event.target.value;
                        if (chosen && chosen !== doc.chunk_info?.chunking_strategy) {
                          handleStrategySelected(
                            doc.id,
                            doc.filename,
                            chosen,
                            doc.chunk_info?.chunk_size,
                            doc.chunk_info?.chunk_overlap,
                          );
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
                    {/* Phase 142: anchored to this cell (position: relative
                        on .chunking-strategy-cell, position: absolute here)
                        instead of a full-page modal or window.confirm() -
                        appears right where the user picked the strategy. */}
                    {confirmTarget?.documentId === doc.id && (
                      <div className="chunking-confirm-popover" role="dialog" aria-label="Apply Chunking Strategy">
                        <div className="chunking-confirm-header">
                          <strong>Apply Chunking Strategy</strong>
                          <button
                            type="button"
                            className="chunking-help-button"
                            aria-label="What does re-embedding mean?"
                            title="What does re-embedding mean?"
                            onClick={() => setShowChunkingHelp((current) => !current)}
                          >
                            ?
                          </button>
                        </div>
                        <p>
                          Re-chunk "{confirmTarget.filename}" with strategy "{confirmTarget.chunkingStrategy}"? This re-embeds the
                          whole document.
                        </p>
                        <div className="chunking-confirm-size-row">
                          <label>
                            Chunk size
                            <input
                              type="number"
                              min={MIN_CHUNK_SIZE}
                              max={MAX_CHUNK_SIZE}
                              value={confirmTarget.chunkSize}
                              onChange={(event) =>
                                setConfirmTarget((current) =>
                                  current ? { ...current, chunkSize: Number(event.target.value) } : current,
                                )
                              }
                            />
                          </label>
                          <label>
                            Overlap
                            <input
                              type="number"
                              min={0}
                              max={Math.floor(confirmTarget.chunkSize / 2)}
                              value={confirmTarget.chunkOverlap}
                              onChange={(event) =>
                                setConfirmTarget((current) =>
                                  current ? { ...current, chunkOverlap: Number(event.target.value) } : current,
                                )
                              }
                            />
                          </label>
                        </div>
                        {showChunkingHelp &&
                          (() => {
                            const currentStrategy = doc.chunk_info?.chunking_strategy ?? "recursive";
                            const newStrategy = confirmTarget.chunkingStrategy;
                            const impact = STRATEGY_IMPACT[newStrategy] ?? STRATEGY_IMPACT.recursive;
                            return (
                              <div className="chunking-help-popover">
                                <p>
                                  <strong>Current: {strategyLabel(currentStrategy)}</strong>{" "}
                                  {STRATEGY_DESCRIPTIONS[currentStrategy] ?? "—"}
                                </p>
                                <p>
                                  <strong>New: {strategyLabel(newStrategy)}</strong> {STRATEGY_DESCRIPTIONS[newStrategy] ?? "—"}
                                </p>
                                <p>
                                  <strong>Expected impact</strong> This document currently has {doc.chunk_count} chunks (
                                  {strategyLabel(currentStrategy)}). {strategyLabel(newStrategy)} tends to produce{" "}
                                  {impact.tendency} - {impact.retrieval}. This re-embeds (re-indexes) the whole document with the
                                  new strategy.
                                </p>
                              </div>
                            );
                          })()}
                        <div className="chunking-confirm-actions">
                          <button type="button" className="secondary" onClick={handleCancelRechunk}>
                            Cancel
                          </button>
                          <button type="button" onClick={handleConfirmRechunk}>
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    {doc.chunk_info?.chunk_size != null
                      ? `${doc.chunk_info.chunk_size} / ${doc.chunk_info.chunk_overlap}`
                      : "—"}
                    {doc.chunk_info?.chunking_strategy && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link-button"
                          disabled={rechunkingId === doc.id}
                          onClick={() => handleEditSizeClicked(doc)}
                        >
                          edit
                        </button>
                      </>
                    )}
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

      {deleteTarget && (
        <ConfirmModal
          title="Delete document"
          message={`Delete "${deleteTarget.filename}"? This removes it from the vector store and database.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showBulkDeleteConfirm && (
        <ConfirmModal
          title="Delete selected documents"
          message={`Delete ${selectedIds.size} document(s)? This removes them from the vector store and database.`}
          detail={documents
            .filter((doc) => selectedIds.has(doc.id))
            .map((doc) => doc.filename)
            .join(", ")}
          onConfirm={handleConfirmBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
