import { Fragment, useState } from "react";
import type { PipelineJobDetail, PipelineStatusResponse, PipelineStepDetail, PipelineWorkflowRun } from "../types";

interface PipelineStepperProps {
  pipeline: PipelineStatusResponse;
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
export default function PipelineStepper({ pipeline }: PipelineStepperProps) {
  const [openHelp, setOpenHelp] = useState<string | null>(null);

  if (pipeline.error) {
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
    const step = run?.jobs.flatMap((job) => job.steps).find((s) => matchesName(s.name));
    return step ? { status: step.status, conclusion: step.conclusion } : null;
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
    <div>
      <div className="phase-bar" style={{ marginBottom: 16 }}>
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
      <p className="dev-note-inline" style={{ marginBottom: 20 }}>
        Build/Security Scan/Static Analysis/Test Suite run independently in parallel within ci.yml, not sequentially
        - shown left-to-right only for a simple at-a-glance summary. ci.yml and deploy.yml are also separate,
        independently-triggered workflows: deploy.yml does not wait for ci.yml to pass before deploying. A gray dot
        means this exact stage has no real data for this specific commit yet (e.g. it ran before a stage was added
        or split) - not a failure.
      </p>

      <div className={`pipeline-banner status-${overallStatusClass(pipeline.runs)}`} style={{ marginBottom: 18 }}>
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
                  <button
                    type="button"
                    className="chunking-help-button"
                    aria-label={`What does ${run.workflow_file} do?`}
                    onClick={() => setOpenHelp(openHelp === run.workflow_file ? null : run.workflow_file)}
                  >
                    ?
                  </button>
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
            {openHelp === run.workflow_file && (
              <div className="chunking-help-popover" style={{ position: "static", marginBottom: 10 }}>
                <p>{WORKFLOW_HELP[run.workflow_file]}</p>
              </div>
            )}

            {run.jobs.map((job, jobIndex) => (
              <div className="pipeline-job" key={jobIndex}>
                <div className="pipeline-job-label">
                  {job.name}
                  {jobDuration(job) ? ` · ${jobDuration(job)}` : ""}
                  {JOB_HELP[job.name] && (
                    <button
                      type="button"
                      className="chunking-help-button"
                      aria-label={`What does ${job.name} do?`}
                      onClick={() => setOpenHelp(openHelp === `job:${job.name}` ? null : `job:${job.name}`)}
                    >
                      ?
                    </button>
                  )}
                </div>
                {openHelp === `job:${job.name}` && (
                  <div className="chunking-help-popover" style={{ position: "static", marginBottom: 8 }}>
                    <p>{JOB_HELP[job.name]}</p>
                  </div>
                )}
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

      <div className="pipeline-run-connector">&darr;</div>
      <div className="pipeline-run">
        <div className="pipeline-run-head">
          <span className="pipeline-run-title">
            Golden dataset release gate
            <button
              type="button"
              className="chunking-help-button"
              aria-label="What is the golden dataset release gate?"
              onClick={() => setOpenHelp(openHelp === "eval-gate" ? null : "eval-gate")}
            >
              ?
            </button>
          </span>
          {pipeline.eval_gate ? (
            <span className={`status-badge status-${pipeline.eval_gate.decision.toLowerCase()}`}>{pipeline.eval_gate.decision}</span>
          ) : (
            <span className="pipeline-run-meta">not run for this commit</span>
          )}
        </div>
        {openHelp === "eval-gate" && (
          <div className="chunking-help-popover" style={{ position: "static", marginBottom: 10 }}>
            <p>{WORKFLOW_HELP["eval-gate"]}</p>
          </div>
        )}
        {pipeline.eval_gate && (
          <p className="dev-note-inline">
            {new Date(pipeline.eval_gate.run_at).toLocaleString()} &middot; {pipeline.eval_gate.scored_cases}/
            {pipeline.eval_gate.total_cases} cases scored &middot;{" "}
            {Object.entries(pipeline.eval_gate.aggregated_scores)
              .map(([metric, value]) => `${metric}: ${value.toFixed(2)}`)
              .join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
