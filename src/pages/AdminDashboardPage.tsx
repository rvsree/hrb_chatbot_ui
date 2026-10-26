import { Fragment, useEffect, useRef, useState } from "react";
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
  getPipelineSnapshot,
  getPipelineStatus,
  getRequestMetrics,
  listAdminDocs,
  listAllConversationsAdmin,
  listAllFeedbackAdmin,
  listAllLeaveRequests,
  listEvalRuns,
  listGoldenDataset,
  listInterviewQaCards,
  listLiveQueries,
  listPipelineSnapshots,
  listSyntheticDataset,
} from "../api/client";
import AdminConversationModal from "../components/AdminConversationModal";
import AdminFeedbackModal from "../components/AdminFeedbackModal";
import HelpPopover from "../components/HelpPopover";
import InterviewQaCardView from "../components/InterviewQaCardView";
import InterviewQaEditorModal from "../components/InterviewQaEditorModal";
import LeaveReviewModal from "../components/LeaveReviewModal";
import PipelineStepper from "../components/PipelineStepper";
import SettingsPanel from "../components/SettingsPanel";
import DocumentsPage from "./DocumentsPage";
import UploadPage from "./UploadPage";
import { useIdentity } from "../context/IdentityContext";
import {
  APPLICATION_LABELS,
  LEAVE_TYPE_LABELS,
  type AdminConversationSummary,
  type AdminDocSummary,
  type Application,
  type CiStatusResponse,
  type EvalRunDetail,
  type EvalRunSummary,
  type FeedbackRecord,
  type GoldenDatasetCaseSummary,
  type HrLeaveRequestSummary,
  type InterviewQaCard,
  type LeaveTypeCode,
  type LiveQuerySummary,
  type PipelineMetricsRow,
  type PipelineSnapshotSummary,
  type PipelineStatusResponse,
  type SyntheticDatasetCaseSummary,
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
  | "live-queries"
  | "synthetic-dataset"
  | "eval-runs"
  | "ci-status"
  | "live-metrics"
  | "settings"
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
  "live-queries": "Live Queries",
  "synthetic-dataset": "Synthetic Dataset",
  "eval-runs": "Eval Runs",
  "ci-status": "CI/CD Pipeline",
  "live-metrics": "Live Metrics",
  settings: "Settings",
  "interview-qa": "Interview Q&A",
};

const COUNTED_TABS = [
  "conversations",
  "feedback",
  "leave-requests",
  "docs",
  "golden-dataset",
  "live-queries",
  "synthetic-dataset",
  "eval-runs",
  "interview-qa",
] as const;

// Phase 168 (round 4) - bulk select + delete added to every tab, run
// concurrently (Promise.allSettled - one failure doesn't block the rest,
// and the UI reports exactly which ones failed) rather than one-row-at-a-
// time, which is what made deleting several rows slow enough to complain
// about in the first place.
const ADMIN_TAB_KEYS = Object.keys(TAB_LABELS) as AdminTab[];

// Phase 191 - 11 flat tabs replaced with 2 levels: a parent category row,
// then that category's own sub-tabs. "Admin" (upload/manage documents,
// conversations, feedback) and "HR Ops" (leave approvals) are visible to
// both admin tiers; "Build & Deployment" and "Interview Q&A" are
// DevOps-only, same split the backend's own routes already enforce -
// gating now happens per category instead of per tab.
type AdminCategory = "admin" | "hr-ops" | "build-deploy" | "interview-qa-ref";

const CATEGORY_LABELS: Record<AdminCategory, string> = {
  admin: "Admin",
  "hr-ops": "HR Ops",
  "build-deploy": "Build & Deployment",
  "interview-qa-ref": "Interview Q&A",
};

const CATEGORY_TABS: Record<AdminCategory, AdminTab[]> = {
  admin: ["documents", "upload", "conversations", "feedback"],
  "hr-ops": ["leave-requests"],
  // Phase 197 - CI/CD Pipeline first (and the category's default focus,
  // via handleSelectCategory's [0] pick) - golden-dataset moved out to
  // interview-qa-ref below, since it's reference content (the 40 test
  // case definitions themselves), not pipeline execution history. Eval
  // Runs stays here - that one really is CI/CD execution history.
  "build-deploy": ["ci-status", "eval-runs", "live-metrics", "settings"],
  // Phase 1 - live-queries/synthetic-dataset join golden-dataset here for
  // the same reason it's here: reference/dataset content, not pipeline
  // execution history (the category's own label is a pre-existing naming
  // oddity, not something this phase fixes - flagged, not in scope).
  "interview-qa-ref": ["docs", "golden-dataset", "live-queries", "synthetic-dataset", "interview-qa"],
};

const CATEGORY_ORDER: AdminCategory[] = ["admin", "hr-ops", "build-deploy", "interview-qa-ref"];
const DEVOPS_ONLY_CATEGORIES: AdminCategory[] = ["build-deploy", "interview-qa-ref"];

function categoryForTab(tab: AdminTab): AdminCategory {
  for (const category of CATEGORY_ORDER) {
    if (CATEGORY_TABS[category].includes(tab)) {
      return category;
    }
  }
  return "admin";
}

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

// 2026-10-19 - standaloneCategory (Phase 233 follow-up, user-reported):
// the earlier "new route, same component" fix only pre-selected a
// category inside the full Admin Dashboard - every other category
// (Admin/HR Ops/Interview Q&A) was still right there to switch to,
// which isn't what "its own separate menu, outside Admin Dashboard"
// actually asked for. When set, this locks the page to exactly one
// category: the category picker row never renders at all, so there's
// nothing to switch away to - genuine separation, not a shortcut into
// the same shared page.
interface AdminDashboardPageProps {
  standaloneCategory?: AdminCategory;
}

export default function AdminDashboardPage({ standaloneCategory }: AdminDashboardPageProps = {}) {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 2026-10-15 - ?tab= deep-links from the Admin dropdown's shortcuts.
  // Falls back to "documents" for a missing/unrecognized value - never
  // trusts the query string blindly. Access is still enforced server-side
  // regardless of which tab this opens on. Phase 191 - the parent category
  // is derived from the deep-linked tab, so a shortcut still lands on the
  // right category/sub-tab pair, not just the right sub-tab in isolation.
  const requestedTab = searchParams.get("tab");
  const initialTab: AdminTab = standaloneCategory
    ? CATEGORY_TABS[standaloneCategory][0]
    : ADMIN_TAB_KEYS.includes(requestedTab as AdminTab)
      ? (requestedTab as AdminTab)
      : "documents";
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [activeCategory, setActiveCategory] = useState<AdminCategory>(standaloneCategory ?? categoryForTab(initialTab));
  const [searchQuery, setSearchQuery] = useState("");
  const [conversations, setConversations] = useState<AdminConversationSummary[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<HrLeaveRequestSummary[]>([]);
  const [docs, setDocs] = useState<AdminDocSummary[]>([]);
  const [goldenDatasetCases, setGoldenDatasetCases] = useState<GoldenDatasetCaseSummary[]>([]);
  const [liveQueries, setLiveQueries] = useState<LiveQuerySummary[]>([]);
  const [liveQueryLtmFilter, setLiveQueryLtmFilter] = useState<"all" | "ltm" | "not-ltm">("all");
  const [syntheticDatasetCases, setSyntheticDatasetCases] = useState<SyntheticDatasetCaseSummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunSummary[]>([]);
  const [ciStatus, setCiStatus] = useState<CiStatusResponse | null>(null);
  const [ciStatusError, setCiStatusError] = useState<string | null>(null);
  // Phase 235 - "Full run history" grid's own page, reset to 1 whenever
  // selectedApplication changes (handleSelectApplication below) - a page
  // number from one application's run list isn't meaningful for another's.
  const [ciStatusPage, setCiStatusPage] = useState(1);
  const [metricsRows, setMetricsRows] = useState<PipelineMetricsRow[]>([]);
  const [metricsWindowHours, setMetricsWindowHours] = useState(24);
  const [interviewQaCards, setInterviewQaCards] = useState<InterviewQaCard[]>([]);
  const [interviewQaTopicFilter, setInterviewQaTopicFilter] = useState<string>("");
  const [viewingInterviewQaCard, setViewingInterviewQaCard] = useState<InterviewQaCard | null>(null);
  const [editingInterviewQaCard, setEditingInterviewQaCard] = useState<InterviewQaCard | null>(null);
  const [isAddingInterviewQaCard, setIsAddingInterviewQaCard] = useState(false);
  const [interviewQaDeleteError, setInterviewQaDeleteError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatusResponse | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  // Phase 237 - per-query scores for the golden dataset gate shown in the
  // Pipeline tab - the same EvalRunDetail shape the Eval Runs tab's own
  // row-click modal already fetches, reused rather than a new endpoint.
  const [evalGateCaseDetail, setEvalGateCaseDetail] = useState<EvalRunDetail | null>(null);
  const [evalGateCaseDetailError, setEvalGateCaseDetailError] = useState<string | null>(null);
  const [pipelineSnapshots, setPipelineSnapshots] = useState<PipelineSnapshotSummary[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | "live">("live");
  // Phase 233 - which real deployable the Pipeline tab is showing.
  // Snapshot history (persist-on-read) stays BACKEND-only on the backend
  // side, so switching away from "backend" always forces "live" too -
  // there's no stored history for the others to view.
  const [selectedApplication, setSelectedApplication] = useState<Application>("backend");
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
  const [selectedSyntheticCase, setSelectedSyntheticCase] = useState<SyntheticDatasetCaseSummary | null>(null);

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

  // Phase 188 - the Pipeline stepper fetches on its own, separately from
  // the shared refresh() above (it can mean several GitHub API calls per
  // fetch, so it only runs while this one tab is actually open). Polls
  // every 10s by self-rescheduling while a run is still in_progress/
  // queued. Phase 189 - only polls the *live* view; viewing a past
  // snapshot (selectedSnapshotId !== "live") pauses this so the picked
  // history isn't overwritten.
  //
  // 2026-10-19 - real bug fix, not a redesign: this used to stop
  // rescheduling outright once everything went terminal - so if you
  // watched a develop push's ci.yml finish, then later merged into
  // master (a real, separate event, often minutes later), this view had
  // already given up and would show the finished develop run forever,
  // never noticing deploy.yml's run even started. Now it keeps a slower
  // background watch going (25s) comparing head_sha - a genuinely new
  // commit's run (detected by a different head_sha) always resumes the
  // fast 10s cadence immediately, same as if it had been running from
  // the start. Only truly stops when this effect's own cleanup runs
  // (tab closed, or the admin switches to a history snapshot).
  //
  // Phase 233 - selectedApplication added to the dependency array so
  // switching the new Application dropdown re-fetches immediately with
  // its own fresh lastSeenSha (a different application's head_sha isn't
  // comparable to the previous one's at all - every switch is treated
  // as a brand-new view, same as the effect's own initial mount).
  useEffect(() => {
    if (!identity || identity.role !== "admin" || activeTab !== "ci-status" || selectedSnapshotId !== "live") {
      return;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    let lastSeenSha: string | null = null;

    async function fetchPipeline() {
      try {
        const result = await getPipelineStatus(identity!, undefined, selectedApplication);
        if (cancelled) return;
        setPipelineStatus(result);
        setPipelineError(null);
        const stillRunning = result.runs.some((run) => run.status === "in_progress" || run.status === "queued");
        const isNewCommit = lastSeenSha !== null && result.head_sha !== lastSeenSha;
        lastSeenSha = result.head_sha;
        timeoutId = window.setTimeout(fetchPipeline, stillRunning || isNewCommit ? 10000 : 25000);
      } catch (err) {
        if (cancelled) return;
        setPipelineError(err instanceof ApiRequestError ? err.message : "Could not load pipeline status.");
      }
    }

    fetchPipeline();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, activeTab, selectedSnapshotId, selectedApplication]);

  // Phase 237 - the golden dataset gate's own per-query breakdown, fetched
  // only once the Pipeline stepper's own fetch above has resolved an
  // eval_gate with a real id (`backend` only - the gate card itself is
  // already backend-only, Phase 236). Reuses getEvalRun(), the exact same
  // call the Eval Runs tab's row-click modal already makes - no new
  // endpoint, no new backend code.
  const evalGateId = pipelineStatus?.eval_gate?.id ?? null;
  useEffect(() => {
    if (!identity || identity.role !== "admin" || activeTab !== "ci-status" || selectedApplication !== "backend" || !evalGateId) {
      setEvalGateCaseDetail(null);
      return;
    }
    let cancelled = false;
    getEvalRun(identity, evalGateId)
      .then((detail) => {
        if (cancelled) return;
        setEvalGateCaseDetail(detail);
        setEvalGateCaseDetailError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setEvalGateCaseDetailError(err instanceof ApiRequestError ? err.message : "Could not load per-query scores.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, activeTab, selectedApplication, evalGateId]);

  // Phase 189 - the run picker's own list, fetched once per tab-open (not
  // polled - history doesn't change as fast as a live run's own status).
  useEffect(() => {
    if (!identity || identity.role !== "admin" || activeTab !== "ci-status") {
      return;
    }
    listPipelineSnapshots(identity)
      .then((result) => setPipelineSnapshots(result.snapshots))
      .catch(() => {
        // Best-effort - the picker just stays empty rather than blocking
        // the live pipeline view above it.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, activeTab]);

  // Phase 235 - "Full run history" grid's own fetch, now re-scoped by
  // selectedApplication/ciStatusPage - pulled out of the page's one big
  // Promise.allSettled load (which only ever ran once per mount) since
  // this now needs to re-fetch independently on every application/page
  // change, same reasoning as the Pipeline stepper's own dedicated effect
  // above. Not polled - run history doesn't change fast enough to need it.
  //
  // 2026-10-19 - user-reported: paging forward, switching to another tab,
  // then back to CI/CD Pipeline silently kept whatever page number was
  // left over from before (ciStatusPage only ever reset on an Application
  // switch, never on simply re-opening this tab) - felt like "it just
  // keeps increasing" across a session even though no single click caused
  // it. wasOnCiStatusTab tracks whether the PREVIOUS render already had
  // this tab open, so a fresh visit always fetches/shows page 1, while
  // Next/Previous clicks within one visit (activeTab staying "ci-status"
  // the whole time) still page normally.
  const wasOnCiStatusTabRef = useRef(false);
  useEffect(() => {
    if (!identity || identity.role !== "admin" || activeTab !== "ci-status") {
      wasOnCiStatusTabRef.current = false;
      return;
    }
    const freshlyOpened = !wasOnCiStatusTabRef.current;
    wasOnCiStatusTabRef.current = true;
    const pageToFetch = freshlyOpened ? 1 : ciStatusPage;
    if (freshlyOpened && ciStatusPage !== 1) {
      setCiStatusPage(1);
    }
    let cancelled = false;
    getCiStatus(identity, selectedApplication, pageToFetch)
      .then((result) => {
        if (cancelled) return;
        setCiStatus(result);
        setCiStatusError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCiStatusError(err instanceof ApiRequestError ? err.message : "Could not load CI status.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, activeTab, selectedApplication, ciStatusPage]);

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
          <p>Only DevOps and Admin can access this page - the backend rejects any other role.</p>
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
    const [
      conversationsResult,
      feedbackResult,
      leaveRequestsResult,
      docsResult,
      goldenDatasetResult,
      liveQueriesResult,
      syntheticDatasetResult,
      evalRunsResult,
      metricsResult,
      interviewQaResult,
    ] = await Promise.allSettled([
      listAllConversationsAdmin(currentIdentity),
      listAllFeedbackAdmin(currentIdentity),
      listAllLeaveRequests(currentIdentity),
      isEngineeringAdmin ? listAdminDocs(currentIdentity) : Promise.resolve({ count: 0, docs: [] }),
      isEngineeringAdmin ? listGoldenDataset(currentIdentity) : Promise.resolve({ count: 0, cases: [] }),
      isEngineeringAdmin
        ? listLiveQueries(currentIdentity, liveQueryLtmFilter === "all" ? undefined : liveQueryLtmFilter === "ltm")
        : Promise.resolve({ count: 0, queries: [] }),
      isEngineeringAdmin ? listSyntheticDataset(currentIdentity) : Promise.resolve({ count: 0, cases: [] }),
      isEngineeringAdmin ? listEvalRuns(currentIdentity) : Promise.resolve({ count: 0, runs: [] }),
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
    if (liveQueriesResult.status === "fulfilled") {
      setLiveQueries(liveQueriesResult.value.queries);
    }
    if (syntheticDatasetResult.status === "fulfilled") {
      setSyntheticDatasetCases(syntheticDatasetResult.value.cases);
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
      failureMessage("live queries", liveQueriesResult),
      failureMessage("synthetic dataset", syntheticDatasetResult),
      failureMessage("eval runs", evalRunsResult),
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

  // Phase 191 - guards a bookmarked/typed ?tab= deep-link into a DevOps-
  // only category for an Admin (employee_admin) identity. The backend
  // already 403s that data regardless, this just stops the dashboard from
  // rendering tab buttons for a category this role can't actually see.
  useEffect(() => {
    if (!identity || identity.role === "admin") {
      return;
    }
    if (DEVOPS_ONLY_CATEGORIES.includes(activeCategory)) {
      setActiveCategory("admin");
      setActiveTab(CATEGORY_TABS.admin[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Phase 233 - switching applications always forces "live": stored
  // snapshot history is backend-only (see the backend's own Phase 233
  // note on pipeline_runs' schema), so a picked snapshot would otherwise
  // keep showing stale backend data under a different application label.
  function handleSelectApplication(value: Application) {
    setSelectedApplication(value);
    setSelectedSnapshotId("live");
    setCiStatusPage(1);
  }

  async function handleSelectSnapshot(value: string) {
    if (value === "live") {
      setSelectedSnapshotId("live");
      return;
    }
    const snapshotId = Number(value);
    setSelectedSnapshotId(snapshotId);
    setPipelineError(null);
    try {
      const result = await getPipelineSnapshot(currentIdentity, snapshotId);
      setPipelineStatus(result);
    } catch (err) {
      setPipelineError(err instanceof ApiRequestError ? err.message : "Could not load this snapshot.");
    }
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

  async function handleLiveQueryLtmFilterChange(next: "all" | "ltm" | "not-ltm") {
    setLiveQueryLtmFilter(next);
    try {
      const result = await listLiveQueries(currentIdentity, next === "all" ? undefined : next === "ltm");
      setLiveQueries(result.queries);
    } catch {
      // Best-effort - the tab just keeps showing the previous filter's
      // data rather than a dedicated error state for this one control.
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
    "live-queries": liveQueries.length,
    "synthetic-dataset": syntheticDatasetCases.length,
    "eval-runs": evalRuns.length,
    "interview-qa": interviewQaCards.length,
  };

  // Admin (employee_admin) gets the Admin/HR Ops categories only - Build &
  // Deployment and Interview Q&A are DevOps ("admin") only, same split the
  // backend's own routes enforce. Display labels only - role values
  // unchanged. Gating is per category now (Phase 191), not per tab.
  const visibleCategories = CATEGORY_ORDER.filter(
    (category) => !DEVOPS_ONLY_CATEGORIES.includes(category) || currentIdentity.role === "admin",
  );
  const visibleTabs = CATEGORY_TABS[activeCategory];

  function handleSelectCategory(category: AdminCategory) {
    setActiveCategory(category);
    setActiveTab(CATEGORY_TABS[category][0]);
    setSearchQuery("");
  }

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
  const filteredLiveQueries = liveQueries.filter((q) => matches([q.query_text, q.pipeline, q.request_id, q.employee_id]));
  const filteredSyntheticDatasetCases = syntheticDatasetCases.filter((c) =>
    matches([c.case_key, c.dataset, c.category, c.query]),
  );
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
    "live-queries": "Search by query text, pipeline, request id, or employee...",
    "synthetic-dataset": "Search by case key, dataset, category, or query...",
    "eval-runs": "Search by decision or date...",
    "interview-qa": "Search by topic or question...",
  };
  const showSharedSearchBar =
    activeTab !== "documents" &&
    activeTab !== "upload" &&
    activeTab !== "ci-status" &&
    activeTab !== "live-metrics" &&
    activeTab !== "settings";

  function renderWorkflowStatus(status: WorkflowStatus) {
    return (
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
          {status.display_name}
          <HelpPopover label={`What file is "${status.display_name}"?`}>
            <p>This is GitHub Actions' own workflow file: <code>{status.workflow_file}</code>.</p>
          </HelpPopover>
        </h3>
        {status.error && <p className="error-banner">{status.error}</p>}
        {/* 2026-10-19 - the shared ciStatusPage can legitimately run past
            THIS workflow's own last page while a different workflow in
            the same grid still has more (e.g. ci.yml runs far more often
            than deploy.yml) - "No runs on this page" instead of "No runs
            found" makes clear that's expected, not an empty workflow. */}
        {!status.error && status.runs.length === 0 && (
          <p className="dev-note-inline">{ciStatusPage > 1 ? "No runs on this page." : "No runs found."}</p>
        )}
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
        {!status.error && <p className="dev-note-inline">{status.total_count} total run(s).</p>}
      </div>
    );
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>{standaloneCategory ? CATEGORY_LABELS[standaloneCategory] : "Admin dashboard"}</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
          {standaloneCategory ? (
            <>
              {" "}
              &middot; <Link to="/admin">Admin dashboard</Link>
            </>
          ) : (
            <>
              {" "}
              &middot; <Link to="/admin/reset-secret-code">Change secret code</Link>
            </>
          )}
        </p>
        {!standaloneCategory && (
          <p className="dev-note">Click a row to view full detail, or check rows for bulk delete. Deletes are permanent.</p>
        )}

        {!standaloneCategory && (
          <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 18 }}>
            {visibleCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeCategory === category ? undefined : "secondary"}
                onClick={() => handleSelectCategory(category)}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        )}

        <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 20 }}>
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

        {activeCategory === "interview-qa-ref" && (
          <p className="dev-note-inline" style={{ marginBottom: 10 }}>
            Legacy interview FAQ content (69 cards, pre-7-part-format) not yet migrated into the DB:{" "}
            <Link to="/admin/open-doc?feature=interview-faqs&type=system">Interview FAQs - System Level</Link>
          </p>
        )}

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

        {!isLoading && activeTab === "live-queries" && (
          <>
            <p className="dev-note-inline">
              Real production questions, scored by the same live groundedness judge every answer already gets.
              Queries scoring above the LTM threshold (Settings &rarr; Memory) are promoted to{" "}
              <code>is_ltm = true</code>. Read-only.
            </p>
            <label style={{ display: "block", marginBottom: 12 }}>
              Filter:{" "}
              <select
                value={liveQueryLtmFilter}
                onChange={(event) => handleLiveQueryLtmFilterChange(event.target.value as "all" | "ltm" | "not-ltm")}
              >
                <option value="all">All</option>
                <option value="ltm">LTM only</option>
                <option value="not-ltm">Not LTM</option>
              </select>
            </label>
            <div className="documents-table-scroll admin-dashboard-table-scroll">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Pipeline</th>
                    <th>Eval score</th>
                    <th>LTM</th>
                    <th>Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLiveQueries.map((liveQuery) => (
                    <tr key={liveQuery.id}>
                      <td>{liveQuery.query_text}</td>
                      <td>{liveQuery.pipeline ?? "-"}</td>
                      <td>{liveQuery.eval_score ?? "-"}</td>
                      <td>{liveQuery.is_ltm ? "Yes" : "No"}</td>
                      <td>{new Date(liveQuery.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {liveQueries.length === 0 && <p className="dev-note-inline">No live queries captured yet.</p>}
              {liveQueries.length > 0 && filteredLiveQueries.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
            </div>
          </>
        )}

        {!isLoading && activeTab === "synthetic-dataset" && (
          <>
            <p className="dev-note-inline">
              Programmatically generated test cases - cheap coverage at scale, lower trust than the hand-verified
              Golden Dataset. Read-only. Click a row for the full case detail.
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
                  {filteredSyntheticDatasetCases.map((syntheticCase) => (
                    <tr
                      key={syntheticCase.id}
                      onClick={() => setSelectedSyntheticCase(syntheticCase)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{syntheticCase.case_key}</td>
                      <td>{syntheticCase.dataset}</td>
                      <td>{syntheticCase.category ?? "-"}</td>
                      <td>{syntheticCase.query ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {syntheticDatasetCases.length === 0 && <p className="dev-note-inline">No synthetic dataset cases yet.</p>}
              {syntheticDatasetCases.length > 0 && filteredSyntheticDatasetCases.length === 0 && (
                <p className="dev-note-inline">No matches for your search.</p>
              )}
            </div>
          </>
        )}

        {!isLoading && activeTab === "settings" && <SettingsPanel userProfile={currentIdentity} />}

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

        {!isLoading && activeTab === "ci-status" && (
          <>
            <p className="dev-note-inline" style={{ marginBottom: 16 }}>
              Deployment Dashboard, part 3 - a live read of this repo's own GitHub Actions runs. Read-only.
            </p>

            {/* 2026-10-20 - user-requested: direct links to the external
                provider dashboards this project actually uses, for
                checking real usage/spend. Neither LangSmith nor Neon
                expose a deep-linkable URL to one specific project/usage
                page from this app's own config - both are login pages,
                with the real project/index name shown next to the link
                so it's clear what to look for once there. */}
            <div style={{ marginBottom: 16, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span className="dev-note-inline">
                <a href="https://smith.langchain.com" target="_blank" rel="noreferrer">
                  LangSmith Dashboard
                </a>{" "}
                - projects <code>hrb_chatbot_v2_local</code> / <code>hrb_chatbot_v2_prod</code>
              </span>
              <span className="dev-note-inline">
                <a href="https://console.neon.tech" target="_blank" rel="noreferrer">
                  Neon Postgres Dashboard
                </a>{" "}
                - Monitoring tab, <code>HR_Benefits</code> project
              </span>
              <span className="dev-note-inline">
                <a
                  href="https://hrb-chatbot-ui.rvsree.dev/admin/open-doc?feature=deployment-guide&type=observability-howto"
                  target="_blank"
                  rel="noreferrer"
                >
                  Observability Doc
                </a>{" "}
                - how to actually check LangSmith/CloudWatch/Pinecone/Neon, step by step
              </span>
            </div>

            <div
              style={{
                display: "flex",
                // 2026-10-19 - user-requested: flex-start, not flex-end -
                // the Application dropdown stays pinned to the left
                // regardless of whether the Viewing dropdown next to it
                // is showing (backend only) or not, instead of the whole
                // row's position shifting with flex-end as that second
                // control appears/disappears.
                justifyContent: "flex-start",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                {/* Phase 233 - dropdown, not child tabs (user-requested,
                    deliberate choice): scales to more applications later
                    without the tab row wrapping/scrolling, same pattern
                    as the "Viewing" selector right next to it. */}
                <label style={{ fontSize: 12 }}>
                  Application:{" "}
                  <select
                    value={selectedApplication}
                    onChange={(e) => handleSelectApplication(e.target.value as Application)}
                  >
                    {(Object.keys(APPLICATION_LABELS) as Application[]).map((app) => (
                      <option key={app} value={app}>
                        {APPLICATION_LABELS[app]}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedApplication === "backend" && (
                  <label style={{ fontSize: 12 }}>
                    Viewing:{" "}
                    <select value={String(selectedSnapshotId)} onChange={(e) => handleSelectSnapshot(e.target.value)}>
                      <option value="live">Live (latest commit)</option>
                      {pipelineSnapshots.map((snapshot) => (
                        <option key={snapshot.id} value={snapshot.id}>
                          {snapshot.head_sha.slice(0, 7)} - {new Date(snapshot.captured_at).toLocaleString()}
                          {snapshot.head_commit_message ? ` - ${snapshot.head_commit_message.slice(0, 40)}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            {selectedSnapshotId !== "live" && (
              <p className="dev-note-inline" style={{ marginBottom: 16 }}>
                Viewing a stored snapshot captured {pipelineSnapshots.find((s) => s.id === selectedSnapshotId)?.captured_at ? new Date(
                  pipelineSnapshots.find((s) => s.id === selectedSnapshotId)!.captured_at,
                ).toLocaleString() : ""} - not live, not polling.
              </p>
            )}
            {pipelineError && <p className="error-banner">{pipelineError}</p>}
            {!pipelineError && pipelineStatus && (
              <PipelineStepper
                pipeline={pipelineStatus}
                application={selectedApplication}
                evalGateCaseDetail={evalGateCaseDetail}
                evalGateCaseDetailError={evalGateCaseDetailError}
                goldenDatasetCases={goldenDatasetCases}
              />
            )}
            {!pipelineError && !pipelineStatus && <p className="dev-note-inline">Loading pipeline...</p>}

            {/* Phase 235 - genuinely scoped by the same Application
                dropdown as the Pipeline stepper above it.
                Phase 255 - no longer hidden for `frontend`: that 2026-10-19
                special case existed only because hrb_chatbot_ui had no
                GitHub Actions workflow at all back then, so this section
                would've been empty under its own heading. It has a real
                deploy.yml now and behaves like every other application. */}
            <h3 style={{ fontSize: 14, margin: "32px 0 12px", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              Full run history
            </h3>
            {ciStatusError && <p className="error-banner">{ciStatusError}</p>}
            {!ciStatusError && ciStatus && ciStatus.error && <p className="dev-note-inline">{ciStatus.error}</p>}
            {!ciStatusError && ciStatus && !ciStatus.error && (
              <>
                {ciStatus.workflows.map((workflow) => (
                  <Fragment key={workflow.workflow_file}>{renderWorkflowStatus(workflow)}</Fragment>
                ))}
                {(ciStatusPage > 1 || ciStatus.workflows.some((workflow) => workflow.has_more)) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                    <button
                      className="button-secondary"
                      disabled={ciStatusPage <= 1}
                      onClick={() => setCiStatusPage((page) => Math.max(1, page - 1))}
                    >
                      Previous
                    </button>
                    <span className="dev-note-inline">Page {ciStatusPage}</span>
                    <button
                      className="button-secondary"
                      disabled={!ciStatus.workflows.some((workflow) => workflow.has_more)}
                      onClick={() => setCiStatusPage((page) => page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
            {!ciStatusError && !ciStatus && <p className="dev-note-inline">Loading run history...</p>}
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
                      <HelpPopover label="Fine-tune recommendation for average latency">
                        <p>{METRIC_RECOMMENDATIONS.avg_latency_ms}</p>
                      </HelpPopover>
                    </th>
                    <th>
                      p95 latency
                      <HelpPopover label="Fine-tune recommendation for p95 latency">
                        <p>{METRIC_RECOMMENDATIONS.p95_latency_ms}</p>
                      </HelpPopover>
                    </th>
                    <th>
                      Total tokens
                      <HelpPopover label="Fine-tune recommendation for total tokens">
                        <p>{METRIC_RECOMMENDATIONS.total_tokens}</p>
                      </HelpPopover>
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

      {selectedSyntheticCase && (
        <div className="modal-overlay" onClick={() => setSelectedSyntheticCase(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{selectedSyntheticCase.case_key}</h2>
            <p className="dev-note-inline">
              Dataset: {selectedSyntheticCase.dataset} &middot; Updated:{" "}
              {new Date(selectedSyntheticCase.updated_at).toLocaleString()}
            </p>
            <pre className="llm-context-pre">{JSON.stringify(selectedSyntheticCase.raw_case, null, 2)}</pre>
            <div className="modal-actions">
              <button type="button" onClick={() => setSelectedSyntheticCase(null)}>
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
