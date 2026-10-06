import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, deleteDocumentById, listDocuments } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { DocumentRecord } from "../types";

export default function DocumentsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || identity.role !== "hr_support") {
      return;
    }
    refresh(identity.employee_id, identity.full_name, identity.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

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

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>Indexed documents</h1>
        <p>
          <Link to="/chat">Back to chat</Link> ·{" "}
          <Link to="/upload">Upload more</Link>
        </p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}

        {!isLoading && documents.length === 0 && !error && <p>No documents indexed yet.</p>}

        {documents.length > 0 && (
          <table className="documents-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Status</th>
                <th>Chunks</th>
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
                  <td className={`status-${doc.status}`}>{doc.status}</td>
                  <td>{doc.chunk_count}</td>
                  <td>{(doc.file_size_bytes / 1024).toFixed(0)} KB</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => handleDelete(doc.id, doc.filename)}>
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
