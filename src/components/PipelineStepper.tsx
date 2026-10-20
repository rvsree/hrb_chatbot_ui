import { Fragment, useState } from "react";
import { RESPONSE_METRIC_GUIDANCE, RETRIEVAL_METRIC_GUIDANCE } from "../constants/evalMetricGuidance";
import HelpPopover from "./HelpPopover";
import type {
  Application,
  EvalRunDetail,
  GoldenDatasetCaseSummary,
  PipelineJobDetail,
  PipelineStatusResponse,
  PipelineStepDetail,
  PipelineWorkflowRun,
} from "../types";

interface PipelineStepperProps {
  pipeline: PipelineStatusResponse;
  // 2026-10-19 - user-requested: a per-application accent color (border
  // stripe, not background) so it's visually obvious which of the 4 real
  // deployables this whole section belongs to, independent of each run's
  // own status color (success/failure/in_progress stay the primary
  // signal - this is a secondary "whose pipeline is this" cue).
  application: Application;
  // Phase 237 - the golden dataset gate's own per-query scores, fetched
  // by AdminDashboardPage (reusing getEvalRun(), the same call the Eval
  // Runs tab's own row-click modal already makes) and passed down rather
  // than fetched here - PipelineStepper has no identity/userProfile of
  // its own to call the API with. null while loading or when there's no
  // eval_gate to fetch detail for.
  evalGateCaseDetail: EvalRunDetail | null;
  evalGateCaseDetailError: string | null;
  // Phase 238 - EvalRunCaseDetail.case_id has no query text of its own
  // (only an id/category/scores) - it's the exact same string as
  // GoldenDatasetCaseSummary.case_key (both ultimately come from
  // golden_dataset.json's own "id" field: scripts/sync_golden_dataset.py
  // and scripts/run_release_gate.py each read it independently, confirmed
  // by reading both), so the real question text is looked up from here
  // instead of adding a new backend field that would just duplicate it.
  goldenDatasetCases: GoldenDatasetCaseSummary[];
}

// Logical pipeline order (ci.yml checks first, deploy.yml ships last) -
// GitHub's own API returns runs for a commit in no guaranteed order, so
// this is what actually makes it read as one pipeline, not a random list.
const WORKFLOW_ORDER: Record<string, number> = {
  "ci.yml": 0,
  "eval-gate.yml": 1,
  "deploy.yml": 2,
  "deploy-lambda.yml": 3,
};

// Phase 195/198 - "?" explainer text, grounded in the real workflow YAML
// (.github/workflows/deploy.yml / deploy-lambda.yml / eval-gate.yml), but
// written for a non-technical reader - the underlying idea and a concrete
// example, not the tool names/flags. No jargon without explaining it.
const WORKFLOW_HELP: Record<string, string> = {
  "deploy.yml":
    "This is what actually makes a change “go live” for real users - like hitting publish on a website update. Once this finishes, anyone using the chatbot sees the new version. It runs automatically every time a finished, approved change is added to the main, trusted copy of the code.",
  "deploy-lambda.yml":
    "The chatbot has two parts: the main “brain” that answers questions, and a separate, smaller helper that quietly processes new documents in the background (for example, reading a new policy PDF so the chatbot can later answer questions about it). This is the publish step for that separate helper only, with its own update process - so a change to the main chatbot doesn't accidentally leave the document-processing helper running old, outdated instructions. That's not a hypothetical risk: this project once shipped a real fix to the main chatbot that the document helper silently never received, because nothing was keeping the two in sync. This workflow exists to prevent that from happening again.",
  "eval-gate":
    "Before trusting a new version of the chatbot with real employees' questions, this runs it through a practice exam first - about 40 real HR questions with known-good answers (for example, “how many paid leave days do I get?”) - and grades how well the chatbot actually answers each one for real, checking both accuracy and whether the answer is really backed by company documents rather than made up. This costs real money, since it has to ask the AI model the questions for real, so it's only run by hand before an important release, not automatically on every small change.",
};

// Phase 196/198 - "?" explainer text for ci.yml's own 4 jobs, same
// plain-language treatment as WORKFLOW_HELP above.
const JOB_HELP: Record<string, string> = {
  "Security Scan":
    "This project is built using a lot of ready-made building blocks written by other developers - the way a recipe might call for a store-bought sauce instead of making one from scratch. This check looks up whether any of those building blocks have a publicly known security weakness, similar to checking whether an ingredient in your pantry has been recalled. Today it only warns, like a smoke alarm that beeps but doesn't shut off the stove by itself - someone still has to look at the warning and decide what to do about it.",
  "Static Analysis":
    "Think of this as a spell-checker, but for security mistakes - and specifically for the code this project's own developers actually wrote, as opposed to the borrowed building blocks Security Scan checks. It reads through that code looking for risky patterns, like a password accidentally left in plain view, or a database question built in a way that could be tricked into leaking information. Unlike the check next to it, this one genuinely stops the release if it finds something serious.",
  "Test suite":
    "Before anything goes live, the system automatically re-runs hundreds of small practice scenarios (about 690 of them) to make sure nothing broke - everything from “if someone asks about their leave balance, does the answer still come back correctly?” to “does the chatbot still correctly refuse to answer something it shouldn't” (its safety guardrails). It's the same idea as a pilot running through a full pre-flight checklist every single time before takeoff, even if yesterday's flight went perfectly - this is that checklist for the whole application, guardrails included, not just one part of it.",
  "Docker image builds":
    "“Building an image” means packing the entire application - the code plus everything it needs to actually run - into one single, self-contained box that can be handed off and run reliably anywhere, the way a meal-kit box comes with every ingredient and instruction needed so it cooks the same no matter whose kitchen it's in. This particular check is just a rehearsal: it confirms the box can be packed successfully. It doesn't ship that box anywhere - the real box actually used to deploy is packed separately, later on.",
  // Phase 197 - backward compat: any commit that ran before the Phase
  // 196 split still has this one combined job in its real GitHub data -
  // gray dots on old commits for "Security Scan"/"Static Analysis" above
  // are correctly showing "this job didn't exist yet under that name,"
  // not a bug. This entry just keeps "?" working for that older data too.
  "Security scan (dependencies + static analysis)":
    "Before this was split into two separate checks, one job did both back to back: looking for known weaknesses in borrowed building blocks (like checking if a pantry ingredient was recalled), and reading through this project's own code for risky patterns (like a security-focused spell-checker). A commit built after the split shows these as two separate boxes instead - Security Scan and Static Analysis.",
};

type NodeResult = { status: string; conclusion: string | null } | null;

// 2026-10-19 - the golden dataset gate's own metric tiles below, split
// into the same 2 logical groups ExplainabilityModal's per-message Eval
// Score tab already uses (Retrieval Score / Response Generation Score) -
// these 5 metrics measure 2 genuinely different things (what was FOUND
// vs. whether what was SAID is any good) and are calculated by 2
// different methods (see EVAL_GATE_CALCULATION below), so splitting them
// into separate tabs here too, not just a flat 5-tile row.
type EvalMetricGroup = "retrieval" | "response";
const EVAL_METRIC_GROUPS: Record<EvalMetricGroup, string[]> = {
  retrieval: ["precision", "recall", "f1"],
  response: ["groundedness", "completeness"],
};
const EVAL_METRIC_GROUP_LABELS: Record<EvalMetricGroup, string> = {
  retrieval: "Retrieval Score",
  response: "Response Generation Score",
};
const EVAL_METRIC_LABELS: Record<string, string> = {
  precision: "Precision",
  recall: "Recall",
  f1: "F1",
  groundedness: "Groundedness",
  completeness: "Completeness",
};

// Grounded in the real scoring code - 2026-10-19 correction: this card
// (the offline golden-dataset gate, scripts/run_release_gate.py) does
// NOT use an LLM judge for Precision/Recall/F1 - it calls
// calculate_retrieval_metrics() (ai/rag_pipeline/evaluations/
// golden_dataset_harness.py), the IK FDE course's own exact-match method:
// each golden dataset case has exactly ONE labeled correct source
// document (expected_source_document), compared by filename against the
// top-k retrieved chunks' own filenames. (The LLM-judge method - a
// separate function, evaluate_retrieval_relevance() in the same file -
// is what powers the LIVE per-message Precision/Recall/F1 shown in the
// Explainability panel for a real query, which has no pre-known correct
// answer to exact-match against. Different methods for 2 different
// situations, confirmed by reading both functions, not assumed - an
// earlier version of this text wrongly described this card using the
// live method.) Groundedness/Completeness ARE LLM-as-judge (confirmed via
// evaluate_groundedness()/evaluate_completeness() in the same file).
function evalGateCalculation(group: EvalMetricGroup, scoredCases: number, retrievalK: number): string {
  if (group === "retrieval") {
    return (
      `Exact-match, not an LLM judge: each of the ${scoredCases} golden dataset queries has exactly ONE labeled ` +
      `correct source document. Precision@${retrievalK} = (1 if that document is in the top ${retrievalK} ` +
      `retrieved, else 0) ÷ ${retrievalK}. Recall@${retrievalK} = 1 if that one document was found anywhere ` +
      `in the top ${retrievalK}, else 0. Because only 1 relevant document can ever exist per query, Precision can ` +
      `never mathematically exceed 1 ÷ ${retrievalK} = ${(1 / retrievalK).toFixed(2)} here, even when ` +
      "retrieval works perfectly every time - that's a structural ceiling of this metric for this dataset's " +
      "design (one canonical source per question), not a quality problem. This is exactly why the release gate " +
      "itself only checks Recall, never Precision/F1, to decide pass/fail (see GATE_METRICS in " +
      "scripts/run_release_gate.py). The 3 numbers above are each the simple average of that per-query score " +
      `across all ${scoredCases} queries. Expand “Per-query scores” below for each query's own number.`
    );
  }
  return (
    "A separate LLM judge call per metric: shown the question, the generated answer, and the documents used, and " +
    "asked to score each 0-10. That raw score is divided by 10 to get the 0.00-1.00 number for that one query. " +
    `The 2 numbers shown above are each the simple average of that query-level score across all ${scoredCases} ` +
    `golden dataset queries (sum of each query's own score ÷ ${scoredCases}). Expand “Per-query scores” ` +
    "below to see each query's own individual number."
  );
}

// Precision/F1 are structurally capped at 1/retrieval_k for this gate
// (see evalGateCalculation above) - flagging them as "needs tuning"
// below 0.80 would be actively misleading, since no retrieval change can
// raise them while this dataset keeps exactly 1 labeled document per
// query. Recall is the metric that's actually meaningful here (and the
// only retrieval metric the real release gate itself checks).
const RECOMMENDATION_ELIGIBLE_METRICS = new Set(["recall", "groundedness", "completeness"]);

// User-requested, 2026-10-19: a recommendation shows for any metric below
// 0.8 specifically in this golden-dataset-gate view - a release-readiness
// bar, deliberately stricter than the 0.70 "good" tile-color threshold
// below (which is a visual at-a-glance scale, not a pass/fail line).
const EVAL_GATE_RECOMMENDATION_THRESHOLD = 0.8;

// Same good/warn/poor banding this app already uses for eval scores
// elsewhere (ExplainabilityModal's below-threshold recommendations) -
// 0.70/0.40 split, not a new convention invented just for this tile.
function scoreBand(value: number): "good" | "warn" | "poor" {
  if (value >= 0.7) return "good";
  if (value >= 0.4) return "warn";
  return "poor";
}

// Precision/F1 always band "poor" (red) under the plain good/warn/poor
// scale for this gate, since they're structurally capped at 1/retrieval_k
// (see evalGateCalculation) - that reads as "broken" at a glance even
// when retrieval is working perfectly. A neutral "capped" band instead,
// for exactly the 2 metrics RECOMMENDATION_ELIGIBLE_METRICS excludes.
function scoreBandForMetric(metric: string, value: number): "good" | "warn" | "poor" | "capped" {
  if (!RECOMMENDATION_ELIGIBLE_METRICS.has(metric)) {
    return "capped";
  }
  return scoreBand(value);
}

// retrieval's own f1 key doesn't exist in RETRIEVAL_METRIC_GUIDANCE's
// response counterpart and vice versa - one lookup covers both groups
// since the keys never collide.
const ALL_METRIC_GUIDANCE: Record<string, { what: string; tune: string[] }> = {
  ...RETRIEVAL_METRIC_GUIDANCE,
  ...RESPONSE_METRIC_GUIDANCE,
};

// Phase 196 - the condensed top summary bar's 8 named stages, each
// resolved against the real job/step data (never a hardcoded status) -
// label text only is fixed, the color/state behind each label is real.
const PHASE_BAR_LABELS = [
  "Build",
  "Security Scan",
  "Static Analysis",
  "Test Suite",
  "Docker Image",
  "Deploy",
  "Smoke Test",
  "Status Notification",
] as const;

// Phase 188/189 - the CI/CD Pipeline Visibility stage view. One connected
// group per workflow file that actually ran for this commit (ci.yml/
// deploy.yml/whatever else - not a hardcoded list, whatever GitHub
// reports), sorted into real pipeline order, each showing its jobs' real
// steps as colored pills with connector arrows between them, plus the
// nearest eval-gate release-gate result if one exists. Every link points
// at the real GitHub Actions log - nothing here re-hosts a log.
export default function PipelineStepper({
  pipeline,
  application,
  evalGateCaseDetail,
  evalGateCaseDetailError,
  goldenDatasetCases,
}: PipelineStepperProps) {
  const [evalGateSubTab, setEvalGateSubTab] = useState<EvalMetricGroup>("retrieval");
  // Phase 238 - which per-query rows have their own Recommendations
  // expanded - a Set, not one "selected row," so more than one weak query
  // can be inspected side by side without losing the first one's detail.
  const [expandedCaseIds, setExpandedCaseIds] = useState<Set<string>>(new Set());

  function toggleCaseExpanded(caseId: string) {
    setExpandedCaseIds((current) => {
      const next = new Set(current);
      if (next.has(caseId)) {
        next.delete(caseId);
      } else {
        next.add(caseId);
      }
      return next;
    });
  }

  if (pipeline.error) {
    // 2026-10-19 - user-reported: this looked like a real failure (red
    // error-banner) even for `frontend`, where it's never one - that
    // branch of get_ci_pipeline_status() always returns the same fixed,
    // expected "deployed manually" message, never a real GitHub-side
    // error. Every OTHER application's own `error` here is a genuine
    // GitHub-side failure, so only `frontend` gets the quieter treatment.
    if (application === "frontend") {
      return <p className="dev-note-inline">{pipeline.error}</p>;
    }
    return <p className="error-banner">{pipeline.error}</p>;
  }
  if (pipeline.runs.length === 0) {
    return <p className="dev-note-inline">No workflow runs found for this commit.</p>;
  }

  const orderedRuns = [...pipeline.runs].sort(
    (a, b) => (WORKFLOW_ORDER[a.workflow_file] ?? 99) - (WORKFLOW_ORDER[b.workflow_file] ?? 99),
  );

  function formatSeconds(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function stepDuration(step: PipelineStepDetail): string {
    if (!step.started_at || !step.completed_at) {
      return step.status === "in_progress" ? "running..." : step.status;
    }
    const seconds = Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000);
    return formatSeconds(seconds);
  }

  // Wall-clock span (first step's start to last step's end), not a sum of
  // per-step durations - steps run sequentially within a job so these
  // agree in practice, but wall-clock is robust to any gap between them.
  function jobDuration(job: PipelineJobDetail): string | null {
    const starts = job.steps.map((step) => step.started_at).filter((value): value is string => Boolean(value));
    const ends = job.steps.map((step) => step.completed_at).filter((value): value is string => Boolean(value));
    if (starts.length === 0 || ends.length === 0) {
      return null;
    }
    const startMs = Math.min(...starts.map((value) => new Date(value).getTime()));
    const endMs = Math.max(...ends.map((value) => new Date(value).getTime()));
    return formatSeconds(Math.round((endMs - startMs) / 1000));
  }

  function runDuration(run: PipelineWorkflowRun): string | null {
    const jobDurations = run.jobs
      .flatMap((job) => job.steps)
      .map((step) => step.started_at && step.completed_at ? [step.started_at, step.completed_at] : null)
      .filter((value): value is [string, string] => value !== null);
    if (jobDurations.length === 0) {
      return null;
    }
    const startMs = Math.min(...jobDurations.map(([start]) => new Date(start).getTime()));
    const endMs = Math.max(...jobDurations.map(([, end]) => new Date(end).getTime()));
    return formatSeconds(Math.round((endMs - startMs) / 1000));
  }

  function stepStatusClass(step: PipelineStepDetail): string {
    return step.conclusion ?? step.status;
  }

  function runStatusClass(run: PipelineWorkflowRun): string {
    return run.conclusion ?? run.status;
  }

  // Aggregated across every stitched-together run - any real failure
  // outranks "still running," which outranks "all good."
  function overallStatusClass(runs: PipelineWorkflowRun[]): string {
    if (runs.some((run) => ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion ?? ""))) {
      return "failure";
    }
    if (runs.some((run) => run.status === "in_progress" || run.status === "queued")) {
      return "in_progress";
    }
    return "success";
  }

  // Wall-clock span across every run's own steps combined - the full
  // observed window of CI/CD activity for this one commit.
  function overallDuration(runs: PipelineWorkflowRun[]): string | null {
    const timestamps = runs
      .flatMap((run) => run.jobs)
      .flatMap((job) => job.steps)
      .map((step) => (step.started_at && step.completed_at ? [step.started_at, step.completed_at] : null))
      .filter((value): value is [string, string] => value !== null);
    if (timestamps.length === 0) {
      return null;
    }
    const startMs = Math.min(...timestamps.map(([start]) => new Date(start).getTime()));
    const endMs = Math.max(...timestamps.map(([, end]) => new Date(end).getTime()));
    return formatSeconds(Math.round((endMs - startMs) / 1000));
  }

  function relativeTime(dateString: string): string {
    const diffSeconds = Math.round((Date.now() - new Date(dateString).getTime()) / 1000);
    if (diffSeconds < 60) return "just now";
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} minute${Math.floor(diffSeconds / 60) === 1 ? "" : "s"} ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} hour${Math.floor(diffSeconds / 3600) === 1 ? "" : "s"} ago`;
    const days = Math.floor(diffSeconds / 86400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function eventLabel(event: string, branch: string): string {
    if (event === "push") return `Push event to branch ${branch}`;
    if (event === "pull_request") return `Pull request targeting ${branch}`;
    if (event === "workflow_dispatch") return "Manually triggered";
    return event ? `${event} event` : "";
  }

  const earliestCreatedAt = orderedRuns.reduce(
    (earliest, run) => (!earliest || run.created_at < earliest ? run.created_at : earliest),
    null as string | null,
  );

  function findJobStatus(workflowFile: string, jobName: string): NodeResult {
    const run = pipeline.runs.find((r) => r.workflow_file === workflowFile);
    const job = run?.jobs.find((j) => j.name === jobName);
    return job ? { status: job.status, conclusion: job.conclusion } : null;
  }

  function findStepStatus(workflowFile: string, matchesName: (name: string) => boolean): NodeResult {
    const run = pipeline.runs.find((r) => r.workflow_file === workflowFile);
    for (const job of run?.jobs ?? []) {
      const stepIndex = job.steps.findIndex((s) => matchesName(s.name));
      if (stepIndex === -1) continue;
      const step = job.steps[stepIndex];
      // Steps within one real GitHub Actions job always execute strictly
      // in order - if a step later in this same job's own list already
      // reached a terminal state, this earlier one must have too,
      // regardless of what its own status field says right now. This
      // guards against GitHub's own Jobs API returning a momentarily
      // inconsistent snapshot during a fast-moving live run (confirmed
      // live, 2026-10-16 - "Deploy" showed green while "Docker Image", an
      // earlier real step in that same job, still showed in_progress in
      // the same single API response). Deliberately scoped to one job's
      // own steps only - never applied across ci.yml's 4 parallel jobs,
      // which have no such ordering guarantee between them.
      const laterTerminalStep = job.steps.slice(stepIndex + 1).find((s) => s.status === "completed");
      if (laterTerminalStep && step.status !== "completed") {
        return { status: "completed", conclusion: step.conclusion ?? "success" };
      }
      return { status: step.status, conclusion: step.conclusion };
    }
    return null;
  }

  function combineResults(results: NodeResult[]): NodeResult {
    const present = results.filter((r): r is NonNullable<NodeResult> => r !== null);
    if (present.length === 0) return null;
    if (present.some((r) => ["failure", "cancelled", "timed_out", "action_required"].includes(r.conclusion ?? ""))) {
      return { status: "completed", conclusion: "failure" };
    }
    if (present.some((r) => r.status === "in_progress" || r.status === "queued")) {
      return { status: "in_progress", conclusion: null };
    }
    return { status: "completed", conclusion: "success" };
  }

  // Resolved against the real data every time this renders - "Docker
  // Image"/"Deploy" each combine 2 real steps within deploy.yml's one
  // job (worst-of-both), since those 2 concepts don't each get their own
  // GitHub job the way ci.yml's 4 checks do.
  const phaseResults: Record<(typeof PHASE_BAR_LABELS)[number], NodeResult> = {
    Build: findJobStatus("ci.yml", "Docker image builds"),
    "Security Scan": findJobStatus("ci.yml", "Security Scan"),
    "Static Analysis": findJobStatus("ci.yml", "Static Analysis"),
    "Test Suite": findJobStatus("ci.yml", "Test suite"),
    "Docker Image": combineResults([
      findStepStatus("deploy.yml", (name) => name === "Build image"),
      findStepStatus("deploy.yml", (name) => name === "Push image to ECR"),
    ]),
    Deploy: combineResults([
      findStepStatus("deploy.yml", (name) => name === "Trigger App Runner deployment"),
      findStepStatus("deploy.yml", (name) => name.startsWith("Wait for the new deployment")),
    ]),
    "Smoke Test": findStepStatus("deploy.yml", (name) => name.startsWith("Deployment smoke test")),
    "Status Notification": findStepStatus("deploy.yml", (name) => name === "Notify deployment status"),
  };

  function phaseNodeClass(result: NodeResult): string {
    if (!result) return "pending";
    return (result.conclusion ?? result.status).toLowerCase();
  }

  return (
    <div className={`pipeline-dashboard pipeline-app-${application}`}>
      {/* 2026-10-19 - user-reported: this showed as all-gray/empty for
          ingestion_lambda (and would for lms_mcp too) - correctly so,
          since every one of these 8 labels is resolved against ci.yml's/
          deploy.yml's own specific job and step names (see phaseResults
          above), which simply don't exist in deploy-lambda.yml's own very
          different single job. Rather than fake-mapping an unrelated
          workflow's real steps onto these 8 backend-specific labels, this
          summary only shows for backend - the detailed per-job/per-step
          cards below it already show every other application's own real
          data accurately. */}
      {application === "backend" && (
        <div className="phase-bar-section">
          <span className="phase-bar-section-label">At-a-glance summary</span>
          <div className="phase-bar">
            {PHASE_BAR_LABELS.map((label, index) => (
              <Fragment key={label}>
                {index > 0 && <span className="phase-bar-connector" />}
                <div className="phase-node">
                  <span className={`phase-node-dot status-${phaseNodeClass(phaseResults[label])}`} />
                  <span className="phase-node-label">{label}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <p className="dev-note-inline phase-bar-note">
            Build/Security Scan/Static Analysis/Test Suite run independently in parallel within ci.yml, not sequentially
            - shown left-to-right only for a simple at-a-glance summary. ci.yml and deploy.yml are also separate,
            independently-triggered workflows: deploy.yml does not wait for ci.yml to pass before deploying. A gray dot
            means this exact stage has no real data for this specific commit yet (e.g. it ran before a stage was added
            or split) - not a failure.
          </p>
        </div>
      )}

      <div className={`pipeline-banner status-${overallStatusClass(pipeline.runs)}`}>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">Branch</span>
          <span className="pipeline-banner-value">{pipeline.head_branch || "-"}</span>
        </div>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">Commit</span>
          <span className="pipeline-banner-value">
            <code>{pipeline.head_sha.slice(0, 7)}</code>
          </span>
        </div>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">Elapsed</span>
          <span className="pipeline-banner-value">{overallDuration(pipeline.runs) ?? "-"}</span>
        </div>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">When</span>
          <span className="pipeline-banner-value">{earliestCreatedAt ? relativeTime(earliestCreatedAt) : "-"}</span>
        </div>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">Changes by</span>
          <span className="pipeline-banner-value">{pipeline.actor_login || "-"}</span>
        </div>
        <div className="pipeline-banner-field">
          <span className="pipeline-banner-label">Trigger</span>
          <span className="pipeline-banner-value">{eventLabel(pipeline.event, pipeline.head_branch) || "-"}</span>
        </div>
      </div>

      {pipeline.head_commit_message && <p className="dev-note-inline" style={{ marginBottom: 10 }}>{pipeline.head_commit_message}</p>}

      {orderedRuns.map((run, runIndex) => (
        <div key={run.id}>
          {runIndex > 0 && <div className="pipeline-run-connector">&darr;</div>}
          <div className="pipeline-run">
            <div className="pipeline-run-head">
              <span className="pipeline-run-title">
                {run.workflow_file} &middot; Build #{run.run_number}
                {WORKFLOW_HELP[run.workflow_file] && (
                  <HelpPopover label={`What does ${run.workflow_file} do?`}>
                    <p>{WORKFLOW_HELP[run.workflow_file]}</p>
                  </HelpPopover>
                )}
              </span>
              <span className={`status-badge status-${runStatusClass(run).toLowerCase()}`}>{run.conclusion ?? run.status}</span>
              <span className="pipeline-run-meta">
                {new Date(run.created_at).toLocaleString()}
                {runDuration(run) ? ` · ${runDuration(run)} total` : ""} &middot;{" "}
                <a href={run.html_url} target="_blank" rel="noreferrer">
                  view on GitHub
                </a>
              </span>
            </div>

            {run.jobs.map((job, jobIndex) => (
              <div className="pipeline-job" key={jobIndex}>
                <div className="pipeline-job-label">
                  {job.name}
                  {jobDuration(job) ? ` · ${jobDuration(job)}` : ""}
                  {JOB_HELP[job.name] && (
                    <HelpPopover label={`What does ${job.name} do?`}>
                      <p>{JOB_HELP[job.name]}</p>
                    </HelpPopover>
                  )}
                </div>
                <div className="pipeline-steps">
                  {job.steps.map((step, stepIndex) => (
                    <Fragment key={stepIndex}>
                      {stepIndex > 0 && <span className="pipeline-step-arrow">&rarr;</span>}
                      <div className={`pipeline-step status-${stepStatusClass(step).toLowerCase()}`}>
                        <span className="pipeline-step-name">{step.name}</span>
                        <span className="pipeline-step-dur">{stepDuration(step)}</span>
                      </div>
                    </Fragment>
                  ))}
                </div>
                {job.html_url && (
                  <div style={{ marginTop: 6 }}>
                    <a href={job.html_url} target="_blank" rel="noreferrer">
                      view full log
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 2026-10-19 - user-requested: the eval-gate workflow itself is
          scoped to backend only (see eval_run_store's own backend-only
          note elsewhere in this project) - showing this section for
          ingestion_lambda/lms_mcp/frontend would always read "not run for
          this commit" for a gate that was never going to run against
          their commits in the first place, not a genuine absence. */}
      {application === "backend" && (
        <>
          <div className="pipeline-run-connector">&darr;</div>
          <div className="pipeline-run">
            <div className="pipeline-run-head">
              <span className="pipeline-run-title">
                Golden dataset release gate
                <HelpPopover label="What is the golden dataset release gate?">
                  <p>{WORKFLOW_HELP["eval-gate"]}</p>
                </HelpPopover>
              </span>
              {pipeline.eval_gate ? (
                <span className={`status-badge status-${pipeline.eval_gate.decision.toLowerCase()}`}>{pipeline.eval_gate.decision}</span>
              ) : (
                <span className="pipeline-run-meta">not run for this commit</span>
              )}
            </div>
            {pipeline.eval_gate && (
              <>
                <p className="dev-note-inline">
                  {new Date(pipeline.eval_gate.run_at).toLocaleString()} &middot; {pipeline.eval_gate.scored_cases}/
                  {pipeline.eval_gate.total_cases} cases scored
                </p>
                {/* 2026-10-19 - user-requested: Retrieval/Response Generation
                    split into their own sub-tabs, same pattern
                    ExplainabilityModal's per-message Eval Score tab already
                    uses for the same underlying distinction. */}
                <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 10, marginBottom: 10 }}>
                  {(Object.keys(EVAL_METRIC_GROUPS) as EvalMetricGroup[]).map((group) => (
                    <button
                      key={group}
                      type="button"
                      className={evalGateSubTab === group ? undefined : "secondary"}
                      onClick={() => setEvalGateSubTab(group)}
                    >
                      {EVAL_METRIC_GROUP_LABELS[group]}
                    </button>
                  ))}
                </div>
                {(() => {
                  const aggregatedScores = pipeline.eval_gate.aggregated_scores;
                  const groupMetrics = EVAL_METRIC_GROUPS[evalGateSubTab].filter((metric) => aggregatedScores[metric] !== undefined);
                  const belowThreshold = groupMetrics.filter(
                    (metric) => RECOMMENDATION_ELIGIBLE_METRICS.has(metric) && aggregatedScores[metric] < EVAL_GATE_RECOMMENDATION_THRESHOLD,
                  );
                  const cases = evalGateCaseDetail?.cases ?? [];
                  return (
                    <>
                      <div className="eval-gate-metrics">
                        {groupMetrics.map((metric) => {
                          const value = aggregatedScores[metric];
                          return (
                            <div className={`eval-gate-metric eval-gate-metric-${scoreBandForMetric(metric, value)}`} key={metric}>
                              <span className="eval-gate-metric-value">{value.toFixed(2)}</span>
                              <span className="eval-gate-metric-label">
                                {EVAL_METRIC_LABELS[metric] ?? metric}
                                {!RECOMMENDATION_ELIGIBLE_METRICS.has(metric) && " (capped)"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="eval-score-group">
                        <span className="eval-score-group-label">How this was calculated</span>
                        <p className="dev-note-inline">
                          {evalGateCalculation(evalGateSubTab, pipeline.eval_gate.scored_cases, pipeline.eval_gate.retrieval_k)}
                        </p>
                      </div>
                      {/* 2026-10-19 - user-requested: a real per-query grid, not
                          just the aggregate above - lets you see which specific
                          golden dataset query is dragging a metric down instead
                          of only the averaged number. Reuses getEvalRun()'s own
                          EvalRunDetail.cases (the same data the Eval Runs tab's
                          row-click modal already shows), fetched by
                          AdminDashboardPage and passed down. Collapsible (native
                          <details>, no extra state needed) so this doesn't
                          permanently eat screen space - user-requested, "manage
                          real estate." */}
                      <details className="eval-gate-details" open>
                        <summary>Per-query scores{cases.length > 0 ? ` (${cases.length} queries)` : ""}</summary>
                        {evalGateCaseDetailError && <p className="error-banner">{evalGateCaseDetailError}</p>}
                        {!evalGateCaseDetailError && cases.length === 0 && (
                          <p className="dev-note-inline">Loading per-query scores...</p>
                        )}
                        {cases.length > 0 && (
                          <div className="documents-table-scroll">
                            <table className="explainability-data-table">
                              <thead>
                                <tr>
                                  <th>Query</th>
                                  <th>Category</th>
                                  {groupMetrics.map((metric) => (
                                    <th key={metric}>{EVAL_METRIC_LABELS[metric] ?? metric}</th>
                                  ))}
                                  <th>Recommendations</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cases.map((caseDetail) => {
                                  // case_id and GoldenDatasetCaseSummary.case_key are
                                  // the same string (both come from golden_dataset.json's
                                  // own "id" field) - see the prop's own doc comment.
                                  const goldenCase = goldenDatasetCases.find((c) => c.case_key === caseDetail.case_id);
                                  const rowBelowThreshold = groupMetrics.filter(
                                    (metric) =>
                                      RECOMMENDATION_ELIGIBLE_METRICS.has(metric) &&
                                      caseDetail.scores[metric] !== undefined &&
                                      caseDetail.scores[metric] < EVAL_GATE_RECOMMENDATION_THRESHOLD,
                                  );
                                  const isExpanded = expandedCaseIds.has(caseDetail.case_id);
                                  return (
                                    <Fragment key={caseDetail.case_id}>
                                      <tr>
                                        <td>{goldenCase?.query ?? caseDetail.case_id}</td>
                                        <td>{caseDetail.category ?? "-"}</td>
                                        {groupMetrics.map((metric) => {
                                          const value = caseDetail.scores[metric];
                                          return (
                                            <td key={metric}>
                                              {value !== undefined ? (
                                                <span className={`eval-gate-case-score eval-gate-metric-${scoreBandForMetric(metric, value)}`}>
                                                  {value.toFixed(2)}
                                                </span>
                                              ) : (
                                                "-"
                                              )}
                                            </td>
                                          );
                                        })}
                                        <td>
                                          {rowBelowThreshold.length === 0 ? (
                                            <span className="dev-note-inline">&#10003; none</span>
                                          ) : (
                                            <button
                                              type="button"
                                              className="secondary"
                                              style={{ fontSize: 11, padding: "3px 8px" }}
                                              onClick={() => toggleCaseExpanded(caseDetail.case_id)}
                                            >
                                              {isExpanded ? "▾ hide" : "▸"} {rowBelowThreshold.length} issue
                                              {rowBelowThreshold.length === 1 ? "" : "s"}
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                      {isExpanded && rowBelowThreshold.length > 0 && (
                                        <tr>
                                          <td colSpan={2 + groupMetrics.length + 1}>
                                            {rowBelowThreshold.map((metric) => (
                                              <div key={metric} style={{ marginBottom: 6 }}>
                                                <p className="dev-note-inline">
                                                  <strong>{EVAL_METRIC_LABELS[metric] ?? metric}</strong> (
                                                  {caseDetail.scores[metric].toFixed(2)}): {ALL_METRIC_GUIDANCE[metric]?.what}
                                                </p>
                                                {ALL_METRIC_GUIDANCE[metric] && (
                                                  <ul className="citation-list">
                                                    {ALL_METRIC_GUIDANCE[metric].tune.map((item) => (
                                                      <li key={item}>{item}</li>
                                                    ))}
                                                  </ul>
                                                )}
                                              </div>
                                            ))}
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </details>
                      {belowThreshold.length > 0 && (
                        <details className="eval-gate-details" open>
                          <summary>
                            Recommendations - {belowThreshold.length} metric{belowThreshold.length === 1 ? "" : "s"} below{" "}
                            {EVAL_GATE_RECOMMENDATION_THRESHOLD.toFixed(2)}
                          </summary>
                          {belowThreshold.map((metric) => (
                            <div key={metric} style={{ marginBottom: 8 }}>
                              <p className="dev-note-inline">
                                <strong>{EVAL_METRIC_LABELS[metric] ?? metric}</strong> ({aggregatedScores[metric].toFixed(2)}):{" "}
                                {ALL_METRIC_GUIDANCE[metric]?.what}
                              </p>
                              {ALL_METRIC_GUIDANCE[metric] && (
                                <ul className="citation-list">
                                  {ALL_METRIC_GUIDANCE[metric].tune.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </details>
                      )}
                    </>
                  );
                })()}
                {pipeline.eval_gate.flags.length > 0 && (
                  <p className="dev-note-inline" style={{ marginTop: 10 }}>
                    Flags: {pipeline.eval_gate.flags.join(", ")}
                  </p>
                )}
                {pipeline.eval_gate.failed_case_ids.length > 0 && (
                  <p className="dev-note-inline">
                    {pipeline.eval_gate.failed_case_ids.length} case(s) failed: {pipeline.eval_gate.failed_case_ids.join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
