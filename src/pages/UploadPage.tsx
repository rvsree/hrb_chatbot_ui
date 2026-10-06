import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, uploadDocuments } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentUploadResult } from "../types";

export default function UploadPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [results, setResults] = useState<DocumentUploadResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    setSelectedFiles(Array.from(event.target.files ?? []));
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

        <input type="file" accept=".pdf" multiple onChange={handleFileSelect} />

        {selectedFiles.length > 0 && (
          <ul className="file-queue">
            {selectedFiles.map((file) => (
              <li key={file.name}>{file.name}</li>
            ))}
          </ul>
        )}

        <button type="button" onClick={handleUpload} disabled={selectedFiles.length === 0 || isUploading}>
          {isUploading ? "Uploading..." : "Upload"}
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
