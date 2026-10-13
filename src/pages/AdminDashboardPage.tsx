import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiRequestError,
  deleteConversationAdmin,
  deleteDocumentById,
  deleteFeedbackAdmin,
  deleteLeaveRequestAdmin,
  getAdminDocContent,
  listAdminDocs,
  listAllConversationsAdmin,
  listAllFeedbackAdmin,
  listAllLeaveRequests,
  listDocuments,
} from "../api/client";
import AdminConversationModal from "../components/AdminConversationModal";
import AdminDocumentModal from "../components/AdminDocumentModal";
import AdminFeedbackModal from "../components/AdminFeedbackModal";
import LeaveReviewModal from "../components/LeaveReviewModal";
import { useIdentity } from "../context/IdentityContext";
import {
  LEAVE_TYPE_LABELS,
  type AdminConversationSummary,
  type AdminDocSummary,
  type DocumentRecord,
  type FeedbackRecord,
  type HrLeaveRequestSummary,
  type LeaveTypeCode,
} from "../types";

type AdminTab = "documents" | "conversations" | "feedback" | "leave-requests" | "docs";

const TAB_LABELS: Record<AdminTab, string> = {
  documents: "KB Documents",
  conversations: "Conversations",
  feedback: "Feedback",
  "leave-requests": "Leave Requests",
  docs: "Architecture Docs",
};

// Phase 168 (round 4) - bulk select + delete added to every tab, run
// concurrently (Promise.allSettled - one failure doesn't block the rest,
// and the UI reports exactly which ones failed) rather than one-row-at-a-
// time, which is what made deleting several rows slow enough to complain
// about in the first place.
export default function AdminDashboardPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<AdminTab>("documents");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [conversations, setConversations] = useState<AdminConversationSummary[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<HrLeaveRequestSummary[]>([]);
  const [docs, setDocs] = useState<AdminDocSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<number | null>(null);

  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<AdminConversationSummary | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<HrLeaveRequestSummary | null>(null);

  const [checkedDocumentIds, setCheckedDocumentIds] = useState<Set<string>>(new Set());
  const [checkedConversationIds, setCheckedConversationIds] = useState<Set<string>>(new Set());
  const [checkedFeedbackIds, setCheckedFeedbackIds] = useState<Set<number>>(new Set());
  const [checkedLeaveRequestIds, setCheckedLeaveRequestIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!identity || identity.role !== "admin") {
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  if (currentIdentity.role !== "admin") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Admin dashboard</h1>
          <p>Only Admin can access this page - the backend rejects any other role.</p>
          <p>
            <Link to="/chat">Back to chat</Link>
          </p>
        </div>
      </div>
    );
  }

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const [documentsResponse, conversationsResponse, feedbackResponse, leaveRequestsResponse, docsResponse] =
        await Promise.all([
          listDocuments(currentIdentity),
          listAllConversationsAdmin(currentIdentity),
          listAllFeedbackAdmin(currentIdentity),
          listAllLeaveRequests(currentIdentity),
          listAdminDocs(currentIdentity),
        ]);
      setDocuments(documentsResponse.documents);
      setConversations(conversationsResponse.conversations);
      setFeedback(feedbackResponse.feedback);
      setLeaveRequests(leaveRequestsResponse.requests);
      setDocs(docsResponse.docs);
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.message} (${err.code})` : "Something went wrong reaching the backend.");
    } finally {
      setIsLoading(false);
    }
  }

  function toggleOne<T>(set: Set<T>, setSet: (next: Set<T>) => void, id: T) {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSet(next);
  }

  function toggleAll<T>(ids: T[], set: Set<T>, setSet: (next: Set<T>) => void) {
    setSet(set.size === ids.length ? new Set() : new Set(ids));
  }

  async function bulkDelete<T>(ids: Set<T>, setSet: (next: Set<T>) => void, deleteOne: (id: T) => Promise<unknown>) {
    if (ids.size === 0) {
      return;
    }
    setIsBulkDeleting(true);
    setBulkDeleteError(null);
    const results = await Promise.allSettled(Array.from(ids).map((id) => deleteOne(id)));
    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      setBulkDeleteError(`${failedCount} of ${ids.size} deletes failed. The rest succeeded - refreshing the list.`);
    }
    setSet(new Set());
    setIsBulkDeleting(false);
    await refresh();
  }

  async function handleOpenDoc(docId: number) {
    setOpeningDocId(docId);
    setError(null);
    try {
      const { download_url } = await getAdminDocContent(currentIdentity, docId);
      window.open(download_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not open the doc.");
    } finally {
      setOpeningDocId(null);
    }
  }

  const tabCounts: Record<AdminTab, number> = {
    documents: documents.length,
    conversations: conversations.length,
    feedback: feedback.length,
    "leave-requests": leaveRequests.length,
    docs: docs.length,
  };

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>Admin dashboard</h1>
        <p>
          <Link to="/chat">Back to chat</Link> &middot; <Link to="/admin/reset-secret-code">Change secret code</Link>
        </p>
        <p className="dev-note">Click a row to view full detail, or check rows for bulk delete. Deletes are permanent.</p>

        <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
          {(Object.keys(TAB_LABELS) as AdminTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? undefined : "secondary"}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]} ({tabCounts[tab]})
            </button>
          ))}
        </div>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}
        {bulkDeleteError && <p className="error-banner">{bulkDeleteError}</p>}

        {!isLoading && activeTab === "documents" && (
          <>
            {checkedDocumentIds.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  bulkDelete(checkedDocumentIds, setCheckedDocumentIds, (id) => deleteDocumentById(currentIdentity, id))
                }
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? "Deleting..." : `Delete ${checkedDocumentIds.size} selected`}
              </button>
            )}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={documents.length > 0 && checkedDocumentIds.size === documents.length}
                        onChange={() =>
                          toggleAll(
                            documents.map((d) => d.id),
                            checkedDocumentIds,
                            setCheckedDocumentIds,
                          )
                        }
                        aria-label="Select all documents"
                      />
                    </th>
                    <th>Filename</th>
                    <th>Status</th>
                    <th>Chunks</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} onClick={() => setSelectedDocument(doc)} style={{ cursor: "pointer" }}>
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedDocumentIds.has(doc.id)}
                          onChange={() => toggleOne(checkedDocumentIds, setCheckedDocumentIds, doc.id)}
                          aria-label={`Select ${doc.filename}`}
                        />
                      </td>
                      <td>{doc.filename}</td>
                      <td>{doc.status}</td>
                      <td>{doc.chunk_count}</td>
                      <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {documents.length === 0 && <p className="dev-note-inline">No documents.</p>}
            </div>
          </>
        )}

        {!isLoading && activeTab === "conversations" && (
          <>
            {checkedConversationIds.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  bulkDelete(checkedConversationIds, setCheckedConversationIds, (id) =>
                    deleteConversationAdmin(currentIdentity, id),
                  )
                }
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? "Deleting..." : `Delete ${checkedConversationIds.size} selected`}
              </button>
            )}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={conversations.length > 0 && checkedConversationIds.size === conversations.length}
                        onChange={() =>
                          toggleAll(
                            conversations.map((c) => c.conversation_id),
                            checkedConversationIds,
                            setCheckedConversationIds,
                          )
                        }
                        aria-label="Select all conversations"
                      />
                    </th>
                    <th>Employee</th>
                    <th>Title</th>
                    <th>Started</th>
                    <th>Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => (
                    <tr
                      key={conversation.conversation_id}
                      onClick={() => setSelectedConversation(conversation)}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedConversationIds.has(conversation.conversation_id)}
                          onChange={() =>
                            toggleOne(checkedConversationIds, setCheckedConversationIds, conversation.conversation_id)
                          }
                          aria-label={`Select ${conversation.title}`}
                        />
                      </td>
                      <td>{conversation.employee_id ?? "unknown"}</td>
                      <td>{conversation.title}</td>
                      <td>{new Date(conversation.started_at).toLocaleDateString()}</td>
                      <td>{new Date(conversation.last_updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {conversations.length === 0 && <p className="dev-note-inline">No conversations.</p>}
            </div>
          </>
        )}

        {!isLoading && activeTab === "feedback" && (
          <>
            {checkedFeedbackIds.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  bulkDelete(checkedFeedbackIds, setCheckedFeedbackIds, (id) => deleteFeedbackAdmin(currentIdentity, id))
                }
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? "Deleting..." : `Delete ${checkedFeedbackIds.size} selected`}
              </button>
            )}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={feedback.length > 0 && checkedFeedbackIds.size === feedback.length}
                        onChange={() =>
                          toggleAll(
                            feedback.map((f) => f.id),
                            checkedFeedbackIds,
                            setCheckedFeedbackIds,
                          )
                        }
                        aria-label="Select all feedback"
                      />
                    </th>
                    <th>Employee</th>
                    <th>Vote</th>
                    <th>Question</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {feedback.map((entry) => (
                    <tr key={entry.id} onClick={() => setSelectedFeedback(entry)} style={{ cursor: "pointer" }}>
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedFeedbackIds.has(entry.id)}
                          onChange={() => toggleOne(checkedFeedbackIds, setCheckedFeedbackIds, entry.id)}
                          aria-label={`Select feedback #${entry.id}`}
                        />
                      </td>
                      <td>{entry.employee_id}</td>
                      <td>{entry.vote}</td>
                      <td>{entry.question}</td>
                      <td>{new Date(entry.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {feedback.length === 0 && <p className="dev-note-inline">No feedback.</p>}
            </div>
          </>
        )}

        {!isLoading && activeTab === "leave-requests" && (
          <>
            {checkedLeaveRequestIds.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  bulkDelete(checkedLeaveRequestIds, setCheckedLeaveRequestIds, (id) =>
                    deleteLeaveRequestAdmin(currentIdentity, id),
                  )
                }
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? "Deleting..." : `Delete ${checkedLeaveRequestIds.size} selected`}
              </button>
            )}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={leaveRequests.length > 0 && checkedLeaveRequestIds.size === leaveRequests.length}
                        onChange={() =>
                          toggleAll(
                            leaveRequests.map((r) => r.hitl_request_context_id),
                            checkedLeaveRequestIds,
                            setCheckedLeaveRequestIds,
                          )
                        }
                        aria-label="Select all leave requests"
                      />
                    </th>
                    <th>Request #</th>
                    <th>Employee</th>
                    <th>Leave type</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((request) => (
                    <tr
                      key={request.hitl_request_context_id}
                      onClick={() => setSelectedLeaveRequest(request)}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedLeaveRequestIds.has(request.hitl_request_context_id)}
                          onChange={() => toggleOne(checkedLeaveRequestIds, setCheckedLeaveRequestIds, request.hitl_request_context_id)}
                          aria-label={`Select request #${request.hitl_request_context_id}`}
                        />
                      </td>
                      <td>#{request.hitl_request_context_id}</td>
                      <td>
                        {request.employee_name ?? "unknown"} ({request.employee_id ?? "unknown"})
                      </td>
                      <td>{LEAVE_TYPE_LABELS[request.leave_type as LeaveTypeCode] ?? request.leave_type}</td>
                      <td>
                        {request.start_date} to {request.end_date}
                      </td>
                      <td>{request.status}</td>
                      <td>{request.decision ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leaveRequests.length === 0 && <p className="dev-note-inline">No leave requests.</p>}
            </div>
          </>
        )}

        {!isLoading && activeTab === "docs" && (
          <>
            <p className="dev-note-inline">
              Architecture/design docs for each use case, synced from <code>docs/dev-reference/</code> to S3. Click a
              row to open it in a new tab.
            </p>
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Version</th>
                    <th>Last synced</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr
                      key={doc.id}
                      onClick={() => handleOpenDoc(doc.id)}
                      style={{ cursor: openingDocId === doc.id ? "wait" : "pointer" }}
                    >
                      <td>{doc.feature_name}</td>
                      <td>{doc.doc_title}</td>
                      <td>{doc.doc_type}</td>
                      <td>v{doc.doc_version}</td>
                      <td>{new Date(doc.last_synced_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {docs.length === 0 && <p className="dev-note-inline">No docs synced yet - run scripts/sync_admin_docs.py.</p>}
            </div>
          </>
        )}
      </div>

      {selectedDocument && (
        <AdminDocumentModal
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onDeleted={() => {
            setSelectedDocument(null);
            refresh();
          }}
        />
      )}
      {selectedConversation && (
        <AdminConversationModal
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onDeleted={() => {
            setSelectedConversation(null);
            refresh();
          }}
        />
      )}
      {selectedFeedback && (
        <AdminFeedbackModal
          entry={selectedFeedback}
          onClose={() => setSelectedFeedback(null)}
          onDeleted={() => {
            setSelectedFeedback(null);
            refresh();
          }}
        />
      )}
      {selectedLeaveRequest && (
        <LeaveReviewModal
          request={selectedLeaveRequest}
          onClose={() => setSelectedLeaveRequest(null)}
          onResolved={() => {
            setSelectedLeaveRequest(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
