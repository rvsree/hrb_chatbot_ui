import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ApiRequestError,
  deleteConversationAdmin,
  deleteFeedbackAdmin,
  deleteInterviewQaCard,
  deleteLeaveRequestAdmin,
  getAdminDocContent,
  getCiStatus,
  getEvalRun,
  getRequestMetrics,
  listAdminDocs,
  listAllConversationsAdmin,
  listAllFeedbackAdmin,
  listAllLeaveRequests,
  listEvalRuns,
  listGoldenDataset,
  listInterviewQaCards,
} from "../api/client";
import AdminConversationModal from "../components/AdminConversationModal";
import AdminFeedbackModal from "../components/AdminFeedbackModal";
import InterviewQaCardView from "../components/InterviewQaCardView";
import InterviewQaEditorModal from "../components/InterviewQaEditorModal";
import LeaveReviewModal from "../components/LeaveReviewModal";
import DocumentsPage from "./DocumentsPage";
import UploadPage from "./UploadPage";
import { useIdentity } from "../context/IdentityContext";
import {
  LEAVE_TYPE_LABELS,
  type AdminConversationSummary,
  type AdminDocSummary,
  type CiStatusResponse,
  type EvalRunDetail,
  type EvalRunSummary,
  type FeedbackRecord,
  type GoldenDatasetCaseSummary,
  type HrLeaveRequestSummary,
  type InterviewQaCard,
  type LeaveTypeCode,
  type PipelineMetricsRow,
  type WorkflowStatus,
} from "../types";

type AdminTab =
  | "documents"
  | "upload"
  | "conversations"
  | "feedback"
  | "leave-requests"
  | "docs"
  | "golden-dataset"
  | "eval-runs"
  | "ci-status"
  | "live-metrics"
  | "interview-qa";

// "documents"/"upload" render the real DocumentsPage/UploadPage components
// directly (not a re-implementation) - so rechunk/replace/upload are real
// here too, not just in the standalone routes. Those two tabs manage their
// own data/search, so they're excluded from tabCounts/SEARCH_PLACEHOLDER
// below, which only cover the four simple filtered-table tabs. "ci-status"
// is excluded too - a single live status object, not a filterable list.
const TAB_LABELS: Record<AdminTab, string> = {
  documents: "KB Documents",
  upload: "Upload Documents",
  conversations: "Conversations",
  feedback: "Feedback",
  "leave-requests": "Leave Approvals",
  docs: "Architecture Docs",
  "golden-dataset": "Golden Dataset",
  "eval-runs": "Eval Runs",
  "ci-status": "CI/Build Status",
  "live-metrics": "Live Metrics",
  "interview-qa": "Interview Q&A",
};

const COUNTED_TABS = [
  "conversations",
  "feedback",
  "leave-requests",
  "docs",
  "golden-dataset",
  "eval-runs",
  "interview-qa",
] as const;

// Phase 168 (round 4) - bulk select + delete added to every tab, run
// concurrently (Promise.allSettled - one failure doesn't block the rest,
// and the UI reports exactly which ones failed) rather than one-row-at-a-
// time, which is what made deleting several rows slow enough to complain
// about in the first place.
const ADMIN_TAB_KEYS = Object.keys(TAB_LABELS) as AdminTab[];

// Phase 184 - curated fine-tune-recommendation text per metric, for the
// Live Metrics tab's "?" popups. Grounded in this project's own real,
// already-documented BACKLOG.md findings - not generic advice, and never
// a live model call.
const METRIC_RECOMMENDATIONS: Record<string, string> = {
  avg_latency_ms:
    "High average latency on multi-agentic-rag specifically points at BACKLOG.md's \"multi-agentic-rag has no per-domain-agent token usage, and no caching\" entry - that pipeline's own domain agents aren't instrumented or cached yet, unlike genai-rag's answer cache (Phase 78).",
  p95_latency_ms:
    "A high p95 (vs. a reasonable average) usually means a few slow outlier requests, not a systemic problem - check whether they cluster on one pipeline or one query pattern before assuming a general slowdown.",
  total_tokens:
    "Token counts alone don't show cost yet - see BACKLOG.md's \"Token cost (in dollars), not just token counts, in Explainability\" entry, a real, already-flagged gap (no verified per-model price table exists in this project).",
  error_rate:
    "A rising error rate is worth checking against BACKLOG.md's \"Output guardrail false positive\" entry (a real false-positive found live, e.g. \"Roth\" masked as a name) before assuming the underlying pipeline itself is broken.",
};

export default function AdminDashboardPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 2026-10-15 - ?tab= deep-links from the Admin dropdown's Engineering-
  // Admin-only shortcuts (Architecture docs/Golden dataset). Falls back to
  // "documents" for a missing/unrecognized value - never trusts the query
  // string blindly. Access is still enforced server-side regardless of
  // which tab this opens on.
  const requestedTab = searchParams.get("tab");
  const initialTab: AdminTab = ADMIN_TAB_KEYS.includes(requestedTab as AdminTab) ? (requestedTab as AdminTab) : "documents";
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [conversations, setConversations] = useState<AdminConversationSummary[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<HrLeaveRequestSummary[]>([]);
  const [docs, setDocs] = useState<AdminDocSummary[]>([]);
  const [goldenDatasetCases, setGoldenDatasetCases] = useState<GoldenDatasetCaseSummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunSummary[]>([]);
  const [ciStatus, setCiStatus] = useState<CiStatusResponse | null>(null);
  const [metricsRows, setMetricsRows] = useState<PipelineMetricsRow[]>([]);
  const [metricsWindowHours, setMetricsWindowHours] = useState(24);
  const [openMetricHelp, setOpenMetricHelp] = useState<string | null>(null);
  const [interviewQaCards, setInterviewQaCards] = useState<InterviewQaCard[]>([]);
  const [interviewQaTopicFilter, setInterviewQaTopicFilter] = useState<string>("");
  const [viewingInterviewQaCard, setViewingInterviewQaCard] = useState<InterviewQaCard | null>(null);
  const [editingInterviewQaCard, setEditingInterviewQaCard] = useState<InterviewQaCard | null>(null);
  const [isAddingInterviewQaCard, setIsAddingInterviewQaCard] = useState(false);
  const [interviewQaDeleteError, setInterviewQaDeleteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<number | null>(null);
  const [selectedEvalRun, setSelectedEvalRun] = useState<EvalRunDetail | null>(null);
  const [isLoadingEvalRunDetail, setIsLoadingEvalRunDetail] = useState(false);
  const [evalRunDetailError, setEvalRunDetailError] = useState<string | null>(null);

  const [selectedConversation, setSelectedConversation] = useState<AdminConversationSummary | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<HrLeaveRequestSummary | null>(null);
  const [selectedGoldenCase, setSelectedGoldenCase] = useState<GoldenDatasetCaseSummary | null>(null);

  const [checkedConversationIds, setCheckedConversationIds] = useState<Set<string>>(new Set());
  const [checkedFeedbackIds, setCheckedFeedbackIds] = useState<Set<number>>(new Set());
  const [checkedLeaveRequestIds, setCheckedLeaveRequestIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!identity || (identity.role !== "admin" && identity.role !== "employee_admin")) {
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

  if (currentIdentity.role !== "admin" && currentIdentity.role !== "employee_admin") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Admin dashboard</h1>
          <p>Only Admin and Employee Admin can access this page - the backend rejects any other role.</p>
          <p>
            <Link to="/chat">Back to chat</Link>
          </p>
        </div>
      </div>
    );
  }

  function failureMessage(label: string, result: PromiseSettledResult<unknown>): string | null {
    if (result.status === "fulfilled") {
      return null;
    }
    const reason = result.reason;
    const detail = reason instanceof ApiRequestError ? `${reason.message} (${reason.code})` : "backend unreachable";
    return `${label}: ${detail}`;
  }

  async function refresh() {
    setIsLoading(true);
    setError(null);
    // allSettled, not all - one tab's fetch failing (e.g. leave requests
    // when hrb_lms_mcp is down) must not blank out the other tabs'
    // already-successful data. Confirmed live: Promise.all's fail-fast
    // behavior was doing exactly that. Documents/Upload aren't fetched
    // here - DocumentsPage/UploadPage below fetch their own data.
    // Architecture Docs / Golden Dataset are ADMIN-only (Engineering
    // Admin) - skipped entirely for employee_admin, which would
    // otherwise 403 and surface a confusing error for a tab that isn't
    // even shown to them.
    const isEngineeringAdmin = currentIdentity.role === "admin";
    const emptyCiStatus: CiStatusResponse = { ci: { runs: [], error: null }, deploy: { runs: [], error: null } };
    const [
      conversationsResult,
      feedbackResult,
      leaveRequestsResult,
      docsResult,
      goldenDatasetResult,
      evalRunsResult,
      ciStatusResult,
      metricsResult,
      interviewQaResult,
    ] = await Promise.allSettled([
      listAllConversationsAdmin(currentIdentity),
      listAllFeedbackAdmin(currentIdentity),
      listAllLeaveRequests(currentIdentity),
      isEngineeringAdmin ? listAdminDocs(currentIdentity) : Promise.resolve({ count: 0, docs: [] }),
      isEngineeringAdmin ? listGoldenDataset(currentIdentity) : Promise.resolve({ count: 0, cases: [] }),
      isEngineeringAdmin ? listEvalRuns(currentIdentity) : Promise.resolve({ count: 0, runs: [] }),
      isEngineeringAdmin ? getCiStatus(currentIdentity) : Promise.resolve(emptyCiStatus),
      isEngineeringAdmin
        ? getRequestMetrics(currentIdentity, metricsWindowHours)
        : Promise.resolve({ window_hours: metricsWindowHours, rows: [] }),
      isEngineeringAdmin ? listInterviewQaCards(currentIdentity) : Promise.resolve({ count: 0, cards: [] }),
    ]);

    if (conversationsResult.status === "fulfilled") {
      setConversations(conversationsResult.value.conversations);
    }
    if (feedbackResult.status === "fulfilled") {
      setFeedback(feedbackResult.value.feedback);
    }
    if (leaveRequestsResult.status === "fulfilled") {
      setLeaveRequests(leaveRequestsResult.value.requests);
    }
    if (docsResult.status === "fulfilled") {
      setDocs(docsResult.value.docs);
    }
    if (goldenDatasetResult.status === "fulfilled") {
      setGoldenDatasetCases(goldenDatasetResult.value.cases);
    }
    if (ciStatusResult.status === "fulfilled") {
      setCiStatus(ciStatusResult.value);
    }
    if (evalRunsResult.status === "fulfilled") {
      setEvalRuns(evalRunsResult.value.runs);
    }
    if (metricsResult.status === "fulfilled") {
      setMetricsRows(metricsResult.value.rows);
    }
    if (interviewQaResult.status === "fulfilled") {
      setInterviewQaCards(interviewQaResult.value.cards);
    }

    const failures = [
      failureMessage("conversations", conversationsResult),
      failureMessage("feedback", feedbackResult),
      failureMessage("leave requests", leaveRequestsResult),
      failureMessage("architecture docs", docsResult),
      failureMessage("golden dataset", goldenDatasetResult),
      failureMessage("eval runs", evalRunsResult),
      failureMessage("CI status", ciStatusResult),
      failureMessage("live metrics", metricsResult),
      failureMessage("interview Q&A", interviewQaResult),
    ].filter((message): message is string => message !== null);

    if (failures.length > 0) {
      setError(`Couldn't load: ${failures.join("; ")}`);
    }

    setIsLoading(false);
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

  async function handleOpenEvalRun(runId: number) {
    setIsLoadingEvalRunDetail(true);
    setEvalRunDetailError(null);
    try {
      const detail = await getEvalRun(currentIdentity, runId);
      setSelectedEvalRun(detail);
    } catch (err) {
      setEvalRunDetailError(err instanceof ApiRequestError ? err.message : "Could not load this eval run's detail.");
    } finally {
      setIsLoadingEvalRunDetail(false);
    }
  }

  async function handleDeleteInterviewQaCard(cardId: number) {
    setInterviewQaDeleteError(null);
    try {
      await deleteInterviewQaCard(currentIdentity, cardId);
      await refresh();
    } catch (err) {
      setInterviewQaDeleteError(err instanceof ApiRequestError ? err.message : "Could not delete this card.");
    }
  }

  async function handleMetricsWindowChange(hours: number) {
    setMetricsWindowHours(hours);
    try {
      const result = await getRequestMetrics(currentIdentity, hours);
      setMetricsRows(result.rows);
    } catch {
      // Best-effort - the tab just keeps showing the previous window's
      // data rather than a dedicated error state for this one control.
    }
  }

  const tabCounts: Partial<Record<AdminTab, number>> = {
    conversations: conversations.length,
    feedback: feedback.length,
    "leave-requests": leaveRequests.length,
    docs: docs.length,
    "golden-dataset": goldenDatasetCases.length,
    "eval-runs": evalRuns.length,
    "interview-qa": interviewQaCards.length,
  };

  // Employee Admin gets every tab except Architecture Docs/Golden Dataset/
  // Eval Runs (all part of the Deployment Dashboard) - Engineering Admin
  // ("admin") only, same split the backend's own routes enforce.
  const ENGINEERING_ADMIN_ONLY_TABS: AdminTab[] = [
    "docs",
    "golden-dataset",
    "eval-runs",
    "ci-status",
    "live-metrics",
    "interview-qa",
  ];
  const visibleTabs = (Object.keys(TAB_LABELS) as AdminTab[]).filter(
    (tab) => !ENGINEERING_ADMIN_ONLY_TABS.includes(tab) || currentIdentity.role === "admin",
  );

  // Milestone 1 - plain case-insensitive substring match across each tab's
  // own visible columns. Small lists (tens of rows), so a fresh .filter()
  // per render is simple and fast enough - no useMemo needed.
  function matches(fields: (string | number | null | undefined)[]): boolean {
    if (!searchQuery.trim()) {
      return true;
    }
    const needle = searchQuery.trim().toLowerCase();
    return fields.some((field) => field != null && String(field).toLowerCase().includes(needle));
  }

  const filteredConversations = conversations.filter((c) => matches([c.employee_id, c.title]));
  const filteredFeedback = feedback.filter((f) => matches([f.employee_id, f.vote, f.question]));
  const filteredLeaveRequests = leaveRequests.filter((r) =>
    matches([r.employee_name, r.employee_id, LEAVE_TYPE_LABELS[r.leave_type as LeaveTypeCode] ?? r.leave_type, r.status, r.decision]),
  );
  const filteredDocs = docs.filter((d) => matches([d.feature_name, d.doc_title, d.doc_type, d.doc_version]));
  const filteredGoldenDatasetCases = goldenDatasetCases.filter((c) => matches([c.case_key, c.dataset, c.category, c.query]));
  const filteredEvalRuns = evalRuns.filter((r) => matches([r.decision, r.run_at]));
  const interviewQaTopics = Array.from(new Set(interviewQaCards.map((c) => c.topic))).sort();
  const filteredInterviewQaCards = interviewQaCards
    .filter((c) => !interviewQaTopicFilter || c.topic === interviewQaTopicFilter)
    .filter((c) => matches([c.topic, c.question]));

  const SEARCH_PLACEHOLDER: Partial<Record<AdminTab, string>> = {
    conversations: "Search by employee or title...",
    feedback: "Search by employee, vote, or question...",
    "leave-requests": "Search by employee, leave type, or status...",
    docs: "Search by feature, title, type, or version...",
    "golden-dataset": "Search by case key, dataset, category, or query...",
    "eval-runs": "Search by decision or date...",
    "interview-qa": "Search by topic or question...",
  };
  const showSharedSearchBar =
    activeTab !== "documents" && activeTab !== "upload" && activeTab !== "ci-status" && activeTab !== "live-metrics";

  function renderWorkflowStatus(workflowFile: string, status: WorkflowStatus) {
    return (
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>{workflowFile}</h3>
        {status.error && <p className="error-banner">{status.error}</p>}
        {!status.error && status.runs.length === 0 && <p className="dev-note-inline">No runs found.</p>}
        {status.runs.length > 0 && (
          <div className="documents-table-scroll admin-dashboard-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Commit</th>
                  <th>Message</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {status.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <span className={`status-badge status-${(run.conclusion ?? run.status).toLowerCase()}`}>
                        {run.conclusion ?? run.status}
                      </span>
                    </td>
                    <td>
                      <code>{run.head_sha}</code>
                    </td>
                    <td>{run.head_commit_message || "-"}</td>
                    <td>{new Date(run.created_at).toLocaleString()}</td>
                    <td>
                      <a href={run.html_url} target="_blank" rel="noreferrer">
                        View on GitHub
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>Admin dashboard</h1>
        <p>
          <Link to="/chat">Back to chat</Link> &middot; <Link to="/admin/reset-secret-code">Change secret code</Link>
        </p>
        <p className="dev-note">Click a row to view full detail, or check rows for bulk delete. Deletes are permanent.</p>

        <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? undefined : "secondary"}
              onClick={() => {
                setActiveTab(tab);
                setSearchQuery("");
              }}
            >
              {TAB_LABELS[tab]}
              {COUNTED_TABS.includes(tab as (typeof COUNTED_TABS)[number]) ? ` (${tabCounts[tab]})` : ""}
            </button>
          ))}
        </div>

        {showSharedSearchBar && (
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={SEARCH_PLACEHOLDER[activeTab]}
            aria-label="Search this table"
            style={{ marginBottom: 12, width: "100%", maxWidth: 420 }}
          />
        )}

        {error && <p className="error-banner">{error}</p>}

        {activeTab === "documents" && <DocumentsPage />}
        {activeTab === "upload" && <UploadPage />}

        {isLoading && activeTab !== "documents" && activeTab !== "upload" && <p>Loading...</p>}

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
            {bulkDeleteError && <p className="error-banner">{bulkDeleteError}</p>}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={filteredConversations.length > 0 && checkedConversationIds.size === filteredConversations.length}
                        onChange={() =>
                          toggleAll(
                            filteredConversations.map((c) => c.conversation_id),
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
                  {filteredConversations.map((conversation) => (
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
              {conversations.length > 0 && filteredConversations.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
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
            {bulkDeleteError && <p className="error-banner">{bulkDeleteError}</p>}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={filteredFeedback.length > 0 && checkedFeedbackIds.size === filteredFeedback.length}
                        onChange={() =>
                          toggleAll(
                            filteredFeedback.map((f) => f.id),
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
                  {filteredFeedback.map((entry) => (
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
              {feedback.length > 0 && filteredFeedback.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
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
            {bulkDeleteError && <p className="error-banner">{bulkDeleteError}</p>}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={filteredLeaveRequests.length > 0 && checkedLeaveRequestIds.size === filteredLeaveRequests.length}
                        onChange={() =>
                          toggleAll(
                            filteredLeaveRequests.map((r) => r.hitl_request_context_id),
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
                  {filteredLeaveRequests.map((request) => (
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
              {leaveRequests.length > 0 && filteredLeaveRequests.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
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
                  {filteredDocs.map((doc) => (
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
              {docs.length > 0 && filteredDocs.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
            </div>
          </>
        )}

        {!isLoading && activeTab === "golden-dataset" && (
          <>
            <p className="dev-note-inline">
              Deployment Dashboard, part 1 - every golden-dataset case (genai-rag and NFR), mirrored from
              resources/golden_dataset/*.json. Read-only. Click a row for the full case detail.
            </p>
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Case key</th>
                    <th>Dataset</th>
                    <th>Category</th>
                    <th>Query</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGoldenDatasetCases.map((goldenCase) => (
                    <tr key={goldenCase.id} onClick={() => setSelectedGoldenCase(goldenCase)} style={{ cursor: "pointer" }}>
                      <td>{goldenCase.case_key}</td>
                      <td>{goldenCase.dataset}</td>
                      <td>{goldenCase.category ?? "-"}</td>
                      <td>{goldenCase.query ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {goldenDatasetCases.length === 0 && (
                <p className="dev-note-inline">No golden dataset cases synced yet - run scripts/sync_golden_dataset.py.</p>
              )}
              {goldenDatasetCases.length > 0 && filteredGoldenDatasetCases.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
            </div>
          </>
        )}

        {!isLoading && activeTab === "eval-runs" && (
          <>
            <p className="dev-note-inline">
              Deployment Dashboard, part 2 - every scripts/run_release_gate.py run on record. Read-only. Click a row
              for every case's own score in that run.
            </p>
            {evalRunDetailError && <p className="error-banner">{evalRunDetailError}</p>}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Run at</th>
                    <th>Decision</th>
                    <th>Scored / Total</th>
                    <th>Recall</th>
                    <th>Groundedness</th>
                    <th>Completeness</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvalRuns.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => handleOpenEvalRun(run.id)}
                      style={{ cursor: isLoadingEvalRunDetail ? "wait" : "pointer" }}
                    >
                      <td>{new Date(run.run_at).toLocaleString()}</td>
                      <td>
                        <span className={`status-badge status-${run.decision.toLowerCase()}`}>{run.decision}</span>
                      </td>
                      <td>
                        {run.scored_cases} / {run.total_cases}
                      </td>
                      <td>{run.aggregated_scores.recall?.toFixed(2) ?? "-"}</td>
                      <td>{run.aggregated_scores.groundedness?.toFixed(2) ?? "-"}</td>
                      <td>{run.aggregated_scores.completeness?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {evalRuns.length === 0 && (
                <p className="dev-note-inline">No eval runs recorded yet - run scripts/run_release_gate.py.</p>
              )}
              {evalRuns.length > 0 && filteredEvalRuns.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
            </div>
          </>
        )}

        {!isLoading && activeTab === "ci-status" && ciStatus && (
          <>
            <p className="dev-note-inline">
              Deployment Dashboard, part 3 - a live read of this repo's own GitHub Actions runs. Read-only.
            </p>
            {renderWorkflowStatus("ci.yml", ciStatus.ci)}
            {renderWorkflowStatus("deploy.yml", ciStatus.deploy)}
          </>
        )}

        {!isLoading && activeTab === "live-metrics" && (
          <>
            <p className="dev-note-inline">
              Deployment Dashboard, part 4 - tokens/latency/error-rate per pipeline, logged on every real response.
              No cost column yet - no verified per-model price table exists in this project. Click a "?" for a
              fine-tune recommendation grounded in this project's own real BACKLOG.md findings.
            </p>
            <label style={{ display: "block", marginBottom: 12 }}>
              Window:{" "}
              <select
                value={metricsWindowHours}
                onChange={(event) => handleMetricsWindowChange(Number(event.target.value))}
              >
                <option value={1}>Last 1 hour</option>
                <option value={24}>Last 24 hours</option>
                <option value={168}>Last 7 days</option>
              </select>
            </label>
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Pipeline</th>
                    <th>Status</th>
                    <th>Requests</th>
                    <th>
                      Avg latency
                      <button
                        type="button"
                        className="chunking-help-button"
                        aria-label="Fine-tune recommendation for average latency"
                        onClick={() => setOpenMetricHelp(openMetricHelp === "avg_latency_ms" ? null : "avg_latency_ms")}
                      >
                        ?
                      </button>
                    </th>
                    <th>
                      p95 latency
                      <button
                        type="button"
                        className="chunking-help-button"
                        aria-label="Fine-tune recommendation for p95 latency"
                        onClick={() => setOpenMetricHelp(openMetricHelp === "p95_latency_ms" ? null : "p95_latency_ms")}
                      >
                        ?
                      </button>
                    </th>
                    <th>
                      Total tokens
                      <button
                        type="button"
                        className="chunking-help-button"
                        aria-label="Fine-tune recommendation for total tokens"
                        onClick={() => setOpenMetricHelp(openMetricHelp === "total_tokens" ? null : "total_tokens")}
                      >
                        ?
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metricsRows.map((row, index) => (
                    <tr key={`${row.pipeline}-${row.status}-${index}`}>
                      <td>{row.pipeline}</td>
                      <td>
                        <span className={`status-badge status-${row.status}`}>{row.status}</span>
                      </td>
                      <td>{row.request_count}</td>
                      <td>{row.avg_latency_ms != null ? `${Math.round(row.avg_latency_ms)} ms` : "-"}</td>
                      <td>{row.p95_latency_ms != null ? `${Math.round(row.p95_latency_ms)} ms` : "-"}</td>
                      <td>{row.total_tokens ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {metricsRows.length === 0 && (
                <p className="dev-note-inline">
                  No requests logged in this window yet - ask a real query against genai-rag/single-agentic-rag/
                  multi-agentic-rag to see data here.
                </p>
              )}
            </div>
            {openMetricHelp && (
              <div className="chunking-help-popover" style={{ position: "static", marginTop: 12 }}>
                <p>{METRIC_RECOMMENDATIONS[openMetricHelp]}</p>
              </div>
            )}
          </>
        )}

        {!isLoading && activeTab === "interview-qa" && (
          <>
            <p className="dev-note-inline">
              Interview Q&A cards - a real, editable DB table (not just static HTML), migrated from the two
              interview-faqs pages. Filter by topic, view a card in its real themed layout, edit, delete, or add new
              ones manually.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <label>
                Topic:{" "}
                <select value={interviewQaTopicFilter} onChange={(e) => setInterviewQaTopicFilter(e.target.value)}>
                  <option value="">All topics</option>
                  {interviewQaTopics.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setIsAddingInterviewQaCard(true)}>
                + Add new
              </button>
            </div>
            {interviewQaDeleteError && <p className="error-banner">{interviewQaDeleteError}</p>}
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>#</th>
                    <th>Question</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInterviewQaCards.map((card) => (
                    <tr key={card.id}>
                      <td>{card.topic}</td>
                      <td>{card.card_order}</td>
                      <td>{card.question}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="secondary" onClick={() => setViewingInterviewQaCard(card)}>
                          View
                        </button>{" "}
                        <button type="button" className="secondary" onClick={() => setEditingInterviewQaCard(card)}>
                          Edit
                        </button>{" "}
                        <button type="button" className="secondary" onClick={() => handleDeleteInterviewQaCard(card.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {interviewQaCards.length === 0 && (
                <p className="dev-note-inline">No cards yet - run scripts/migrate_interview_qa_to_db.py or add one manually.</p>
              )}
              {interviewQaCards.length > 0 && filteredInterviewQaCards.length === 0 && (
                <p className="dev-note-inline">No matches for your search/filter.</p>
              )}
            </div>
          </>
        )}
      </div>

      {selectedEvalRun && (
        <div className="modal-overlay" onClick={() => setSelectedEvalRun(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>Eval run - {new Date(selectedEvalRun.run_at).toLocaleString()}</h2>
            <p className="dev-note-inline">
              Decision: {selectedEvalRun.decision} &middot; Retrieval k={selectedEvalRun.retrieval_k}
            </p>
            {selectedEvalRun.flags.length > 0 && (
              <ul className="citation-list">
                {selectedEvalRun.flags.map((flag, index) => (
                  <li key={index}>{flag}</li>
                ))}
              </ul>
            )}
            <div className="documents-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Scores</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEvalRun.cases.map((caseDetail) => (
                    <tr key={caseDetail.case_id}>
                      <td>{caseDetail.case_id}</td>
                      <td>{caseDetail.category ?? "-"}</td>
                      <td>{caseDetail.status}</td>
                      <td>
                        {Object.entries(caseDetail.scores)
                          .map(([metric, value]) => `${metric}: ${value.toFixed(2)}`)
                          .join(", ") || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setSelectedEvalRun(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedGoldenCase && (
        <div className="modal-overlay" onClick={() => setSelectedGoldenCase(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{selectedGoldenCase.case_key}</h2>
            <p className="dev-note-inline">
              Dataset: {selectedGoldenCase.dataset} &middot; Updated: {new Date(selectedGoldenCase.updated_at).toLocaleString()}
            </p>
            <pre className="llm-context-pre">{JSON.stringify(selectedGoldenCase.raw_case, null, 2)}</pre>
            <div className="modal-actions">
              <button type="button" onClick={() => setSelectedGoldenCase(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingInterviewQaCard && (
        <div className="modal-overlay" onClick={() => setViewingInterviewQaCard(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 640 }}>
            <InterviewQaCardView card={viewingInterviewQaCard} />
            <div className="modal-actions">
              <button type="button" onClick={() => setViewingInterviewQaCard(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {(isAddingInterviewQaCard || editingInterviewQaCard) && (
        <InterviewQaEditorModal
          card={editingInterviewQaCard}
          defaultTopic={interviewQaTopicFilter || null}
          onClose={() => {
            setIsAddingInterviewQaCard(false);
            setEditingInterviewQaCard(null);
          }}
          onSaved={() => {
            setIsAddingInterviewQaCard(false);
            setEditingInterviewQaCard(null);
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
