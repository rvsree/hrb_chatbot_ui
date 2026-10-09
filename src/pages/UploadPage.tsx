import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, getDocument, getHealth, requestPresignedUpload, uploadFileToS3 } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { UserProfile } from "../types";
import { statusLabel } from "../utils/documentStatus";

// Matches text_chunker.py's CHUNKING_STRATEGIES - same list DocumentsPage.tsx
// uses for re-chunking. "auto" sends no override - the backend picks per-document.
const CHUNKING_STRATEGIES = ["auto", "recursive", "fixed", "markdown", "html", "none", "document_structure", "semantic"];

// Phase 88/89 (backend, already live): S3 -> SQS -> Lambda indexes
// asynchronously, so there's no synchronous result to show - poll
// GET /documents/{id} instead, same TERMINAL_STATUSES/POLL_INTERVAL_MS
// DocumentsPage.tsx already polls with.
const TERMINAL_STATUSES = new Set(["indexed", "failed"]);
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 120_000;

interface LiveUploadStatus {
  filename: string;
  status: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Matches models/documents.py's real ALLOWED_CONTENT_TYPE/MAX_FILE_SIZE_BYTES
// exactly - PDF only, 20MB, today. Word/.docx and CSV are NOT yet
// supported server-side (ai/doc_processing/ only has extract_text_from_pdf())
// - widening this without real backend extraction support would let a file
// through the picker that then fails confusingly server-side instead of
// here, where the reason is clear.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

interface FileRejection {
  filename: string;
  reason: string;
}

function validateAndMergeFiles(existing: File[], incoming: File[]): { accepted: File[]; rejections: FileRejection[] } {
  const accepted = [...existing];
  const rejections: FileRejection[] = [];

  for (const file of incoming) {
    if (!isPdf(file)) {
      rejections.push({ filename: file.name, reason: "Only PDF files are accepted right now." });
      continue;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejections.push({ filename: file.name, reason: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB - the limit is 20MB.` });
      continue;
    }
    const alreadyAdded = accepted.some((entry) => entry.name === file.name && entry.size === file.size);
    if (!alreadyAdded) {
      accepted.push(file);
    }
  }

  return { accepted, rejections };
}

export default function UploadPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [results, setResults] = useState<LiveUploadStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [chunkingStrategy, setChunkingStrategy] = useState("auto");
  const [activeEmbeddingModel, setActiveEmbeddingModel] = useState<string | null>(null);
  const [rejections, setRejections] = useState<FileRejection[]>([]);

  useEffect(() => {
    // Best-effort - just doesn't display if this fails. Read-only here: the
    // embedding model is a global client setting, not a per-upload choice.
    getHealth()
      .then((health) => setActiveEmbeddingModel(health.embedding_model))
      .catch(() => {});
  }, []);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  if (identity.role !== "hr_support") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Document upload</h1>
          <p>Only HR Support can upload documents - the backend rejects any other role.</p>
          <Link to="/chat">Back to chat</Link>
        </div>
      </div>
    );
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const { accepted, rejections: newRejections } = validateAndMergeFiles(selectedFiles, Array.from(event.target.files ?? []));
    setSelectedFiles(accepted);
    setRejections(newRejections);
    setResults([]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    const { accepted, rejections: newRejections } = validateAndMergeFiles(selectedFiles, Array.from(event.dataTransfer.files ?? []));
    setSelectedFiles(accepted);
    setRejections(newRejections);
    setResults([]);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave() {
    setIsDraggingOver(false);
  }

  function removeFile(fileToRemove: File) {
    setSelectedFiles((current) => current.filter((file) => file !== fileToRemove));
  }

  function updateResult(filename: string, patch: Partial<LiveUploadStatus>) {
    setResults((current) => current.map((entry) => (entry.filename === filename ? { ...entry, ...patch } : entry)));
  }

  async function pollUntilIndexed(userProfile: UserProfile, documentId: string, filename: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const document = await getDocument(userProfile, documentId);
      updateResult(filename, { status: document.status, error: document.error_message ?? undefined });
      if (TERMINAL_STATUSES.has(document.status)) {
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    updateResult(filename, { status: "timed_out", error: "Still processing - check Manage Documents in a bit." });
  }

  async function uploadOneFile(file: File, strategyOverride: string | undefined) {
    const contentType = file.type || "application/pdf";
    try {
      updateResult(file.name, { status: "requesting_url" });
      const presigned = await requestPresignedUpload(currentIdentity, file.name, contentType, strategyOverride);
      updateResult(file.name, { status: "uploading" });
      await uploadFileToS3(presigned.upload_url, file, contentType);
      updateResult(file.name, { status: "pending_upload" });
      await pollUntilIndexed(currentIdentity, presigned.document_id, file.name);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        updateResult(file.name, { status: "failed", error: `${error.message} (${error.code})` });
      } else {
        updateResult(file.name, { status: "failed", error: "Something went wrong reaching the backend." });
      }
    }
  }

  async function handleUpload() {
    if (selectedFiles.length === 0 || isUploading) {
      return;
    }
    setIsUploading(true);
    setRejections([]);

    const filesToUpload = selectedFiles;
    const strategyOverride = chunkingStrategy === "auto" ? undefined : chunkingStrategy;
    setSelectedFiles([]);
    setResults(filesToUpload.map((file) => ({ filename: file.name, status: "requesting_url" })));

    // Concurrent, by explicit request - each file's own presigned-upload
    // request, S3 PUT, and poll loop run independently, not one after
    // another. Tradeoff worth knowing: RAG-ROADMAP.md Phase 88 flagged
    // that the real Lambda has no reserved-concurrency cap, so a large
    // batch here competes with any other indexing activity for the
    // account's shared pool - acceptable at this project's real scale,
    // not free at a much larger batch size.
    await Promise.all(filesToUpload.map((file) => uploadOneFile(file, strategyOverride)));

    setIsUploading(false);
  }

  return (
    <div className="centered-page">
      <div className="card upload-card">
        <h1>Document upload</h1>
        <p>
          <Link to="/chat">Back to chat</Link> · <Link to="/documents">Manage documents</Link> ·{" "}
          <Link to="/feedback">View feedback</Link>
        </p>

        <div className="upload-settings-row">
          <label>
            Chunking strategy:{" "}
            <select value={chunkingStrategy} onChange={(event) => setChunkingStrategy(event.target.value)}>
              {CHUNKING_STRATEGIES.map((strategy) => (
                <option key={strategy} value={strategy}>
                  {strategy}
                </option>
              ))}
            </select>
          </label>
          <span className="dev-note-inline">
            Embedding model: {activeEmbeddingModel ?? "—"} (fixed server-side, not a per-upload choice)
          </span>
        </div>

        <p className="dev-note-inline">
          Accepted: PDF only (.pdf), up to 20MB per file. Word (.docx) and CSV support is planned but not available
          yet - selecting one will be rejected below, not silently skipped.
        </p>

        {rejections.length > 0 && (
          <ul className="file-queue">
            {rejections.map((rejection, index) => (
              <li key={`${rejection.filename}-${index}`} className="status-rejected">
                <strong>{rejection.filename}</strong>: {rejection.reason}
              </li>
            ))}
          </ul>
        )}

        <div
          className={isDraggingOver ? "dropzone dropzone-active" : "dropzone"}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <p>Drag PDFs here, or:</p>
          <div className="dropzone-actions">
            <label className="file-picker-button">
              Select files
              <input type="file" accept=".pdf" multiple onChange={handleFileSelect} hidden />
            </label>
            <label className="file-picker-button">
              Select folder
              <input
                type="file"
                // @ts-expect-error - webkitdirectory isn't in the standard DOM types but every major browser supports it
                webkitdirectory=""
                multiple
                onChange={handleFileSelect}
                hidden
              />
            </label>
          </div>
        </div>

        {selectedFiles.length > 0 && (
          <ul className="file-queue">
            {selectedFiles.map((file) => (
              <li key={`${file.name}-${file.size}`}>
                {file.name}
                <button type="button" className="link-button" onClick={() => removeFile(file)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={handleUpload} disabled={selectedFiles.length === 0 || isUploading}>
          {isUploading ? "Uploading..." : `Upload ${selectedFiles.length} file(s)`}
        </button>

        {results.length > 0 && (
          <ul className="file-queue">
            {results.map((result) => (
              <li key={result.filename}>
                <strong>{result.filename}</strong>{" "}
                <span className={`status-badge status-${result.status}`}>{statusLabel(result.status, result.error)}</span>
                {result.error && <span> ({result.error})</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
