import { useState, type ChangeEvent, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, uploadDocuments } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentUploadResult } from "../types";

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function mergeFiles(existing: File[], incoming: File[]): File[] {
  const merged = [...existing];
  for (const file of incoming) {
    if (!isPdf(file)) {
      continue;
    }
    const alreadyAdded = merged.some((entry) => entry.name === file.name && entry.size === file.size);
    if (!alreadyAdded) {
      merged.push(file);
    }
  }
  return merged;
}

export default function UploadPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [results, setResults] = useState<DocumentUploadResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

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
    setSelectedFiles((current) => mergeFiles(current, Array.from(event.target.files ?? [])));
    setResults([]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    setSelectedFiles((current) => mergeFiles(current, Array.from(event.dataTransfer.files ?? [])));
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

  async function handleUpload() {
    if (selectedFiles.length === 0 || isUploading) {
      return;
    }
    setIsUploading(true);
    setUploadError(null);

    try {
      const response = await uploadDocuments(currentIdentity, selectedFiles);
      setResults(response.results);
      setSelectedFiles([]);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setUploadError(`${error.message} (${error.code})`);
      } else {
        setUploadError("Something went wrong reaching the backend.");
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="card upload-card">
        <h1>Document upload</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
        </p>

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
          {isUploading ? `Uploading ${selectedFiles.length} file(s)...` : `Upload ${selectedFiles.length} file(s)`}
        </button>

        {uploadError && <p className="error-banner">{uploadError}</p>}

        {results.length > 0 && (
          <ul className="file-queue">
            {results.map((result) => (
              <li key={result.filename} className={`status-${result.status}`}>
                <strong>{result.filename}</strong> - {result.status}
                {result.error && <span> ({result.error})</span>}
                {result.message && <span> ({result.message})</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
