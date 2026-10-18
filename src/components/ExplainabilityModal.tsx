import { useState, type ReactNode } from "react";
import { useIdentity } from "../context/IdentityContext";
import type { ChatMessage, RetrievedChunk, ToolCallInfo } from "../types";

interface ExplainabilityModalProps {
  message: ChatMessage;
  originalQuery: string | null;
  onClose: () => void;
}

// Labels for the known tool_type values; anything else (a future source
// type the backend starts sending) falls back to "Other" rather than
// being dropped or rendered as a raw snake_case string.
const KNOWN_TOOL_TYPE_LABELS: Record<string, string> = {
  vector_db: "Vector DB",
  mcp: "MCP",
  web_search: "Web Search",
  sql_db: "SQL DB",
  other: "Other",
};

function toolTypeLabel(toolType: string): string {
  return KNOWN_TOOL_TYPE_LABELS[toolType] ?? "Other";
}

// Knowledge Sources panel covers genai-rag (plain vector search, no agent)
// and single-agentic-rag (real LangChain tool calls) too, not just
// multi-agentic-rag's own domain agents - tool_type, not agent name, is
// the right key here.
const TOOL_TYPE_DESCRIPTIONS: Record<string, string> = {
  vector_db: "A search against the indexed HR benefits documents using vector similarity.",
  mcp: "A call to the Leave Management System for the caller's own live data (leave balance, leave history).",
  web_search: "A search of the public web for information outside the internal knowledge base.",
  sql_db: "A query against structured HR data (not implemented yet in the live pipeline).",
  other: "A tool call that doesn't fall into one of the other known categories.",
};

// Agent model (user-requested, this conversation): the 3 workflow agents
// every multi-agentic-rag query goes through, plus all 5 domain agents the
// backend code actually defines - 2 of which (sql_db_agent/lms_analytics_agent)
// are non-functional stubs today, shown rather than hidden so the panel
// stays honest about what's real vs. placeholder, same spirit as this
// project's existing "Dollar cost intentionally out of scope" notes.
interface AgentInfo {
  label: string;
  description: string;
  implemented: boolean;
}

const WORKFLOW_AGENT_INFO: Record<"planner" | "orchestrator" | "reviewer", AgentInfo> = {
  planner: {
    label: "Planner",
    description: "Reads the question and decides which domain agent(s) should handle it, splitting a compound question into separate focused tasks when needed. One LLM call.",
    implemented: true,
  },
  orchestrator: {
    label: "Orchestrator",
    description: "Dispatches every task the Planner produced to its domain agent, all at once, in parallel. A mechanical routing step, not a separate LLM call - it doesn't decide anything itself, just fans out what the Planner already decided.",
    implemented: true,
  },
  reviewer: {
    label: "Reviewer",
    description: "Combines every domain agent's result into one final answer. Always runs, even when only one domain agent was dispatched, since a domain agent's raw output isn't meant to be shown to the user directly. One LLM call.",
    implemented: true,
  },
};

const DOMAIN_AGENT_INFO: Record<string, AgentInfo> = {
  vector_kb_agent: {
    label: "KB Vector Agent",
    description: "Searches the indexed HR benefits documents (401k, healthcare, tuition, leave policies) using vector similarity search - the same knowledge base genai-rag's own retrieval uses.",
    implemented: true,
  },
  lms_ops_agent: {
    label: "LMS Agent",
    description: "Calls the Leave Management System via MCP tool calls for the caller's own live data - leave balance, leave history. Not from the document knowledge base.",
    implemented: true,
  },
  web_search_agent: {
    label: "Web Search Agent",
    description: "Searches the public web for information not covered by the internal knowledge base (e.g. general IRS tax rules referenced by a benefits question).",
    implemented: true,
  },
  sql_db_agent: {
    label: "SQL DB Agent",
    description: "Planned to query structured HR data directly via SQL. Not implemented yet - currently always returns a fixed \"not available\" message with no real logic.",
    implemented: false,
  },
  lms_analytics_agent: {
    label: "LMS Analytics Agent",
    description: "Planned to answer aggregate/analytics questions over LMS data. Not implemented yet - currently always returns a fixed \"not available\" message with no real logic.",
    implemented: false,
  },
};

// A real hover/focus popover, not the native `title` attribute - title's
// own browser tooltip was reported not visibly appearing (inconsistent
// delay/behavior across browsers). CSS-only, no extra component state:
// `.info-icon-wrap:hover`/`:focus-within` reveals `.info-icon-tooltip`.
// The icon is a real <button> (not a <span>) so it's focusable - keyboard
// users and tap-to-focus on touch devices both trigger it, not hover only.
// Real per-agent metrics, not a guess - Phase 205/206 added latency_ms to
// each LlmContextTurn and iteration to each ToolCallInfo specifically so
// these lookups are exact, not inferred from array order.
function turnByLabel(message: ChatMessage, label: string) {
  return message.explainability?.llm_context?.turns.find((turn) => turn.label === label) ?? null;
}

function toolCallByName(message: ChatMessage, toolName: string) {
  return message.toolsUsed?.find((call) => call.tool_name === toolName) ?? null;
}

function toolCallsForIteration(message: ChatMessage, iteration: number) {
  return (message.toolsUsed ?? []).filter((call) => call.iteration === iteration);
}

function InfoIcon({ info }: { info: AgentInfo }) {
  const suffix = info.implemented ? "" : " (not implemented yet)";
  return (
    <span className="info-icon-wrap">
      <button
        type="button"
        className={info.implemented ? "info-icon" : "info-icon info-icon-unimplemented"}
        aria-label={`${info.label} - ${info.description}${suffix}`}
      >
        ?
      </button>
      <span className="info-icon-tooltip" role="tooltip">
        <strong>{info.label}</strong>
        <br />
        {info.description}
        {suffix}
      </span>
    </span>
  );
}

interface TechStackItem {
  name: string;
  version: string;
  note: string;
}

// Static reference content (user-requested, this conversation) - read
// directly from requirements.txt/package.json, not guessed. Not every pin
// in those files, just the ones that explain this system's own
// architecture - transitive-only dependencies are left out.
const TECH_STACK_GROUPS: { label: string; items: TechStackItem[] }[] = [
  {
    label: "Backend - API & Validation",
    items: [
      { name: "FastAPI", version: "0.115.5", note: "Web framework" },
      { name: "Uvicorn", version: "0.30.6", note: "ASGI server" },
      { name: "Pydantic", version: "2.13.5", note: "Request/response validation" },
    ],
  },
  {
    label: "Backend - LLM & Agent Orchestration",
    items: [
      { name: "LangChain", version: "0.3.20", note: "Chunking, retrieval, chain orchestration" },
      { name: "LangChain-OpenAI", version: "0.3.35", note: "LangChain's OpenAI chat model adapter" },
      { name: "LangGraph", version: "0.3.21", note: "Multi-agentic-rag's Planner/dispatch/Reviewer graph" },
      { name: "LangGraph-Checkpoint-Postgres", version: "2.0.25", note: "Pause/resume state for the unpaid-leave HITL graph" },
      { name: "LlamaIndex-Core", version: "0.13.6", note: "Document indexing" },
      { name: "OpenAI SDK", version: "2.54.0", note: "Primary LLM/embedding provider client" },
      { name: "Anthropic SDK", version: "1.2.0", note: "Secondary LLM provider client" },
    ],
  },
  {
    label: "Backend - Retrieval & Storage",
    items: [
      { name: "ChromaDB", version: "1.3.5", note: "Vector database (default)" },
      { name: "Pinecone", version: "7.3.0", note: "Vector database (alternate provider)" },
      { name: "psycopg", version: "3.2.5", note: "Postgres driver (metadata, conversation memory, metrics)" },
      { name: "Redis", version: "8.1.0", note: "Answer cache, embedding cache, rate limiting" },
    ],
  },
  {
    label: "Backend - Guardrails & Tools",
    items: [
      { name: "NeMo Guardrails", version: "0.24.1", note: "Input/output guardrails" },
      { name: "Presidio", version: "2.2.364", note: "PII detection/masking" },
      { name: "MCP SDK", version: "1.9.4", note: "Model Context Protocol client (LMS tool calls)" },
    ],
  },
  {
    label: "Frontend",
    items: [
      { name: "React", version: "19.2.8", note: "UI framework" },
      { name: "React Router", version: "7.18.4", note: "Client-side routing" },
      { name: "TypeScript", version: "6.0.2", note: "Type checking" },
      { name: "Vite", version: "8.3.0", note: "Build tool / dev server" },
      { name: "Playwright", version: "1.64.0", note: "End-to-end testing" },
    ],
  },
];

type ExplainabilityTab =
  | "metrics"
  | "agentFlow"
  | "retrievalEval"
  | "responseEval"
  | "engineeringTrace"
  | "llmContext"
  | "citations"
  | "techStack";

const EXPLAINABILITY_TABS: { id: ExplainabilityTab; label: string }[] = [
  { id: "metrics", label: "Metrics" },
  { id: "agentFlow", label: "Agent Flow" },
  { id: "retrievalEval", label: "Retrieval Eval Score" },
  { id: "responseEval", label: "Response Generation Eval Score" },
  { id: "engineeringTrace", label: "Engineering Trace" },
  { id: "llmContext", label: "LLM Context" },
  { id: "citations", label: "Citations" },
  { id: "techStack", label: "Tech Stack" },
];

type PipelineMode = "genai-rag" | "single-agentic-rag" | "multi-agentic-rag";

function detectPipelineMode(message: ChatMessage): PipelineMode {
  if (message.tasks && message.tasks.length > 0) return "multi-agentic-rag";
  if (message.explainability?.llm_context?.turns.some((turn) => turn.label.startsWith("iteration "))) {
    return "single-agentic-rag";
  }
  return "genai-rag";
}

// Cross-references a captured turn's label back to the real named prompt
// constant that produced it (ai/prompts/agent_prompts.py / response_generator.py) -
// a lookup, not a guess: every label this project's own backend code emits is
// handled explicitly below.
function promptConstantForTurn(label: string, mode: PipelineMode): string {
  if (label === "planner") return "PLANNER_SYSTEM_PROMPT";
  if (label === "reviewer" || label.startsWith("Merging ")) return "REVIEWER_SYSTEM_PROMPT";
  if (label.startsWith("iteration ")) return "ORCHESTRATION_SYSTEM_PROMPT";
  if (mode === "genai-rag") return "RAG_PROMPT (or CONVERSATIONAL_FALLBACK_PROMPT if no chunks were retrieved)";
  return "unknown";
}

interface KnowledgeSourceEntry {
  name: string;
  detail: string;
  latencyMs: number | null;
  failed: boolean;
}

// Single place every pipeline mode's "where did this answer's knowledge
// come from" renders through - real tool/agent calls when there are any,
// else a synthetic single entry describing a plain vector-store search
// (genai-rag's non-agentic path, which never calls a "tool" at all).
function knowledgeSourceGroups(message: ChatMessage): [string, KnowledgeSourceEntry[]][] {
  if (message.toolsUsed && message.toolsUsed.length > 0) {
    const groups = new Map<string, ToolCallInfo[]>();
    for (const call of message.toolsUsed) {
      const existing = groups.get(call.tool_type);
      if (existing) {
        existing.push(call);
      } else {
        groups.set(call.tool_type, [call]);
      }
    }
    return [...groups.entries()].map(([toolType, calls]) => [
      toolType,
      calls.map((call) => ({
        name: call.tool_name,
        detail: call.tool_input,
        latencyMs: call.latency_ms,
        failed: !call.success,
      })),
    ]);
  }

  if (message.retrievalInfo) {
    const filter = message.retrievalInfo.applied_filter;
    return [
      [
        "vector_db",
        [
          {
            name: message.retrievalInfo.vector_db,
            detail: `${message.retrievalInfo.search_strategy} search${filter ? ` - filter: ${JSON.stringify(filter)}` : ""}`,
            latencyMs: null,
            failed: false,
          },
        ],
      ],
    ];
  }

  return [];
}

// Plain <details>/<summary> - native expand/collapse, no extra state to
// manage, keyboard/accessibility support for free. `defaultOpen` only sets
// the INITIAL state; the browser handles toggling from there, so every
// section stays independently expandable regardless of the others.
function CollapsibleSection({
  title,
  defaultOpen,
  nested,
  children,
}: {
  title: ReactNode;
  defaultOpen: boolean;
  nested?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={nested ? "explainability-section explainability-section-nested" : "explainability-section"} open={defaultOpen}>
      <summary>{title}</summary>
      <div className="explainability-section-body">{children}</div>
    </details>
  );
}

function chunkKey(source: RetrievedChunk): string {
  return `${source.document_id}-${source.chunk_index}`;
}

// Phase 140: llm_call_count was one opaque total with no way to tell how
// much of it was answer generation vs. eval (judge) calls vs. genai-rag's
// own decomposition step - all derivable from fields already in the
// response, no backend change needed. llm_context is only ever populated
// for a fresh (non-cached, non-MCP-fast-path) genai-rag call (Phase 132 -
// null on a cache hit, MCP fast-path, or single/multi-agentic-rag), so it
// doubles as "was this a fresh genai-rag call" without needing the
// conversation-level mode threaded into each message.
//
// llm_call_count itself EXCLUDES eval calls (models/rag.py's own field
// description says so) - the first shipped version of this function
// quietly re-displayed that partial count as if it were the grand total
// right next to a breakdown that implied otherwise ("LLM calls: 4
// (answer: 4, eval: 2)" - a real, reported bug, 4+2=6 not 4). The headline
// number shown must be the true sum of every part in the breakdown.
function describeLlmCalls(message: ChatMessage): string {
  const explainability = message.explainability;
  if (!explainability) {
    return "0";
  }
  if (explainability.llm_call_count === 0) {
    return "0";
  }
  const isFreshGenaiRagCall = explainability.llm_context !== null;
  const evalCalls = explainability.eval_scores ? 2 : 0;
  const decomposeCalls = isFreshGenaiRagCall ? 1 : 0;
  const answerCalls = explainability.llm_call_count - decomposeCalls;
  const total = explainability.llm_call_count + evalCalls;

  const parts = [`answer: ${answerCalls}`, `eval: ${evalCalls}`];
  if (isFreshGenaiRagCall) {
    parts.push(`decompose: ${decomposeCalls}`);
  }
  return `${total} (${parts.join(", ")})`;
}

// Phase 136 - a deliberately small, separate view for a Chat GenAI Workflow
// answer. No Knowledge Sources/Citations/LLM Context-with-chunk-attribution
// sections - there is no vector store or persisted KB in this path, so
// none of the main view's sections apply.
function AdhocExplainability({ message, originalQuery, onClose }: ExplainabilityModalProps) {
  const adhoc = message.adhoc!;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability - Chat GenAI Workflow</h2>
        <p className="dev-note-inline">
          Ad-hoc document chat - answered from attached files{adhoc.webSearches.length > 0 ? " and the web" : ""}, no knowledge base or vector store involved.
        </p>

        <div className="panel panel-success">
          <span className="panel-eyebrow">User Query</span>
          <p className="kb-query-text">{originalQuery ?? "Not available for this message."}</p>
        </div>

        {/* Phase 145: renamed from "Files Read" now that SearchWeb exists -
            shown as two labeled groups, same pattern the main Explainability
            view already uses for its own Knowledge Sources panel, rather
            than inventing a new layout for this one. */}
        <div className="panel panel-info">
          <span className="panel-eyebrow">Knowledge Sources</span>
          {adhoc.filesUsed.length === 0 && adhoc.webSearches.length === 0 ? (
            <p>The agent answered without reading any attached file or searching the web.</p>
          ) : (
            <>
              {adhoc.filesUsed.length > 0 && (
                <div className="knowledge-source-group">
                  <span className="dev-note-inline">Files ({adhoc.filesUsed.length})</span>
                  <ul className="citation-list">
                    {adhoc.filesUsed.map((filename) => (
                      <li key={filename}>{filename}</li>
                    ))}
                  </ul>
                </div>
              )}
              {adhoc.webSearches.length > 0 && (
                <div className="knowledge-source-group">
                  <span className="dev-note-inline">Web Search ({adhoc.webSearches.length})</span>
                  <ul className="citation-list">
                    {adhoc.webSearches.map((query, index) => (
                      <li key={`${query}-${index}`}>{query}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="panel panel-info">
          <span className="panel-eyebrow">Latency &amp; Tokens</span>
          <ul className="citation-list">
            <li>Total time: {adhoc.totalMs.toFixed(0)}ms</li>
            <li>LLM calls: {adhoc.llmCallCount}</li>
            <li>Reasoning steps: {adhoc.iterations}</li>
            {message.modelUsed && <li>Model: {message.modelUsed}</li>}
            {adhoc.tokenUsage ? (
              <li>
                Tokens: {adhoc.tokenUsage.prompt_tokens} prompt + {adhoc.tokenUsage.completion_tokens} completion ={" "}
                {adhoc.tokenUsage.total_tokens} total
              </li>
            ) : (
              <li>Tokens: n/a</li>
            )}
          </ul>
        </div>

        {/* Phase 161 - shown whenever SendEmailWithAnswer was called at all,
            sent or failed, so a failure (e.g. SES_SENDER_EMAIL not
            configured) is visible instead of indistinguishable from "no
            email asked for at all". Defaults open on a failure - the user
            shouldn't have to know to expand it to find out why nothing
            arrived - and closed on a quiet success. */}
        {adhoc.emailEvidence && (
          <CollapsibleSection
            title={
              <>
                Email{" "}
                <span
                  className={adhoc.emailEvidence.sent ? "knowledge-source-group-label" : "knowledge-source-failed"}
                >
                  {adhoc.emailEvidence.sent ? "sent" : "failed"}
                </span>
              </>
            }
            defaultOpen={!adhoc.emailEvidence.sent}
          >
            <div className={adhoc.emailEvidence.sent ? "panel panel-success" : "panel panel-warning"}>
              <ul className="citation-list">
                <li>Recipient: {adhoc.emailEvidence.recipient_email}</li>
                <li>Subject: {adhoc.emailEvidence.subject}</li>
                <li>Sent at: {new Date(adhoc.emailEvidence.sent_at).toLocaleString()}</li>
                <li>
                  Attachments:{" "}
                  {adhoc.emailEvidence.attached_files.length > 0
                    ? adhoc.emailEvidence.attached_files.join(", ")
                    : "none"}
                </li>
                <li>Status: {adhoc.emailEvidence.message}</li>
              </ul>
            </div>
          </CollapsibleSection>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExplainabilityModal(props: ExplainabilityModalProps) {
  const { message, originalQuery, onClose } = props;
  const { identity } = useIdentity();
  const knowledgeGroups = knowledgeSourceGroups(message);
  const llmContext = message.explainability?.llm_context;
  const sources = message.sources ?? [];
  const [selectedChunkKey, setSelectedChunkKey] = useState<string | null>(null);
  const selectedChunk = sources.find((source) => chunkKey(source) === selectedChunkKey) ?? null;
  const [activeTab, setActiveTab] = useState<ExplainabilityTab>("metrics");

  if (message.adhoc) {
    return <AdhocExplainability {...props} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability</h2>

        <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 18 }}>
          {EXPLAINABILITY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? undefined : "secondary"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "metrics" && (
          <div className="explainability-tab-panel">
          <div className="explainability-row">
            {knowledgeGroups.length > 0 && (
              <div className="panel panel-info">
                <span className="panel-eyebrow">Knowledge Sources</span>
                {knowledgeGroups.map(([toolType, entries]) => (
                  <div className="knowledge-source-group" key={toolType}>
                    <span className="knowledge-source-group-label">
                      {toolTypeLabel(toolType)} ({entries.length})
                      {" "}
                      <InfoIcon
                        info={{
                          label: toolTypeLabel(toolType),
                          description: TOOL_TYPE_DESCRIPTIONS[toolType] ?? TOOL_TYPE_DESCRIPTIONS.other,
                          implemented: toolType !== "sql_db",
                        }}
                      />
                    </span>
                    <ul className="citation-list">
                      {entries.map((entry, index) => (
                        <li key={`${entry.name}-${index}`}>
                          <strong>{entry.name}</strong>: {entry.detail}
                          {entry.failed && <span className="knowledge-source-failed"> - failed</span>}
                          {entry.latencyMs !== null && <span> - {entry.latencyMs.toFixed(0)}ms</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

          </div>

          <div className="explainability-row">
            {message.explainability ? (
              <div className={message.explainability.served_from_cache ? "panel panel-success" : "panel panel-info"}>
                <span className="panel-eyebrow">Latency &amp; Tokens</span>
                <ul className="citation-list">
                  <li>Request ID: <code>{message.explainability.request_id}</code></li>
                  {message.explainability.served_from_cache && <li>Served from cache</li>}
                  <li>Total time: {message.explainability.latency_ms.total.toFixed(0)}ms</li>
                  {message.explainability.latency_ms.retrieval !== null && (
                    <li>Retrieval: {message.explainability.latency_ms.retrieval.toFixed(0)}ms</li>
                  )}
                  {message.explainability.latency_ms.generation !== null && (
                    <li>Generation: {message.explainability.latency_ms.generation.toFixed(0)}ms</li>
                  )}
                  <li>LLM calls: {describeLlmCalls(message)}</li>
                  {message.iterations !== undefined && <li>Reasoning steps: {message.iterations}</li>}
                  {message.modelUsed && <li>Model: {message.modelUsed}</li>}
                  {message.explainability.temperature !== null && (
                    <li>Temperature: {message.explainability.temperature}</li>
                  )}
                  {message.explainability.token_usage ? (
                    <li>
                      Tokens: {message.explainability.token_usage.prompt_tokens} prompt +{" "}
                      {message.explainability.token_usage.completion_tokens} completion ={" "}
                      {message.explainability.token_usage.total_tokens} total
                    </li>
                  ) : (
                    <li>
                      Tokens: n/a ({message.explainability.llm_call_count > 0 ? "not tracked per-agent yet" : "no LLM call made"})
                    </li>
                  )}
                </ul>
                <p className="dev-note-inline">Dollar cost is intentionally out of scope - see BACKLOG.md.</p>
              </div>
            ) : (
              <div className="panel panel-warning">
                <span className="panel-eyebrow">Latency &amp; Tokens</span>
                <p>Not tracked for this pipeline mode yet (genai-rag only so far - see RAG-ROADMAP.md Phase 107).</p>
              </div>
            )}
          </div>
          </div>
        )}

        {activeTab === "agentFlow" && (
          <div className="explainability-tab-panel">
          {message.tasks && message.tasks.length > 0 ? (
            <div className="panel panel-info">
              <span className="panel-eyebrow">
                Agent Flow (multi-agentic-rag){" "}
                <InfoIcon
                  info={{
                    label: "Agent Flow",
                    description: "Planner decides who should handle this question, Orchestrator dispatches those tasks in parallel, each domain agent runs, Reviewer merges every result into one answer.",
                    implemented: true,
                  }}
                />
              </span>
              <table className="explainability-data-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>LLM calls</th>
                    <th>Tool calls</th>
                    <th>Elapsed</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const plannerTurn = turnByLabel(message, "planner");
                    return (
                      <tr>
                        <td><strong>{WORKFLOW_AGENT_INFO.planner.label}</strong> <InfoIcon info={WORKFLOW_AGENT_INFO.planner} /></td>
                        <td>{plannerTurn ? 1 : 0}</td>
                        <td>0</td>
                        <td>{plannerTurn?.latency_ms !== null && plannerTurn?.latency_ms !== undefined ? `${plannerTurn.latency_ms.toFixed(0)}ms` : "n/a"}</td>
                        <td className="dev-note-inline">routed to {message.tasks.length} agent{message.tasks.length === 1 ? "" : "s"}</td>
                      </tr>
                    );
                  })()}
                  <tr>
                    <td><strong>{WORKFLOW_AGENT_INFO.orchestrator.label}</strong> <InfoIcon info={WORKFLOW_AGENT_INFO.orchestrator} /></td>
                    <td>0</td>
                    <td>0</td>
                    <td>n/a</td>
                    <td className="dev-note-inline">mechanical dispatch, not a real LLM/tool call</td>
                  </tr>
                  {message.tasks.map((task, index) => {
                    const agentInfo = DOMAIN_AGENT_INFO[task.agent];
                    const call = toolCallByName(message, task.agent);
                    return (
                      <tr key={`${task.agent}-${index}`}>
                        <td><strong>{agentInfo?.label ?? task.agent}</strong> {agentInfo && <InfoIcon info={agentInfo} />}</td>
                        <td>0</td>
                        <td>{call ? 1 : 0}</td>
                        <td>
                          {call?.latency_ms !== null && call?.latency_ms !== undefined ? `${call.latency_ms.toFixed(0)}ms` : "n/a"}
                          {call && !call.success && <span className="knowledge-source-failed"> - failed</span>}
                        </td>
                        <td className="dev-note-inline">
                          {task.focus}
                          <br />
                          <em>Why: {task.reasoning}</em>
                        </td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const reviewerTurn = turnByLabel(message, "reviewer");
                    return (
                      <tr>
                        <td><strong>{WORKFLOW_AGENT_INFO.reviewer.label}</strong> <InfoIcon info={WORKFLOW_AGENT_INFO.reviewer} /></td>
                        <td>{reviewerTurn ? 1 : 0}</td>
                        <td>0</td>
                        <td>{reviewerTurn?.latency_ms !== null && reviewerTurn?.latency_ms !== undefined ? `${reviewerTurn.latency_ms.toFixed(0)}ms` : "n/a"}</td>
                        <td className="dev-note-inline">merges every agent's result into one answer</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
              <p className="dev-note-inline">
                Chain-of-thought: not explicitly prompted for today - verified by reading
                ai/prompts/agent_prompts.py directly, no agent's system prompt asks the model to state its reasoning
                before acting. The "Response" shown per call (LLM Context tab) is each LLM's actual output text, not
                a separate reasoning trace.
              </p>
            </div>
          ) : message.explainability?.llm_context?.turns.some((turn) => turn.label.startsWith("iteration ")) ? (
            <div className="panel panel-info">
              <span className="panel-eyebrow">
                ReAct Flow (single-agentic-rag){" "}
                <InfoIcon
                  info={{
                    label: "ReAct Flow",
                    description: "One LLM call per iteration - the model either calls a tool and loops again, or answers directly and stops. Up to max_iterations (default 5).",
                    implemented: true,
                  }}
                />
              </span>
              <table className="explainability-data-table">
                <thead>
                  <tr>
                    <th>Iteration</th>
                    <th>Elapsed</th>
                    <th>Tool call(s)</th>
                    <th>Response text</th>
                  </tr>
                </thead>
                <tbody>
                  {message.explainability.llm_context.turns.map((turn, index) => {
                    const iterationNumber = index + 1;
                    const calls = toolCallsForIteration(message, iterationNumber);
                    return (
                      <tr key={turn.label}>
                        <td>{iterationNumber}</td>
                        <td>{turn.latency_ms !== null ? `${turn.latency_ms.toFixed(0)}ms` : "n/a"}</td>
                        <td>
                          {calls.length === 0
                            ? <span className="dev-note-inline">none - final answer</span>
                            : calls.map((call) => (
                                <div key={call.tool_name}>
                                  {call.tool_name}
                                  {!call.success && <span className="knowledge-source-failed"> - failed</span>}
                                </div>
                              ))}
                        </td>
                        <td className="dev-note-inline">{turn.response ? turn.response : "(empty - tool call only, no text alongside it)"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="dev-note-inline">
                Chain-of-thought: not explicitly prompted for today - verified by reading
                ai/prompts/agent_prompts.py directly, ORCHESTRATION_SYSTEM_PROMPT never asks the model to state its
                reasoning before calling a tool. Tool-calling models often return empty response text on an
                iteration where they only call a tool (shown above, not hidden) - that's a real model behavior, not
                a capture gap.
              </p>
            </div>
          ) : (
            <div className="panel panel-warning">
              <p>
                Not applicable for this pipeline mode - genai-rag is a single retrieve-then-generate call with no
                agent loop at all. See the Knowledge Sources panel on the Metrics tab instead.
              </p>
            </div>
          )}
          </div>
        )}

        {activeTab === "retrievalEval" && (
          <div className="explainability-tab-panel">
          <div className="panel panel-info">
            <span className="panel-eyebrow">
              Live precision for this answer{" "}
              <InfoIcon
                info={{
                  label: "Live retrieval precision",
                  description: "One LLM call sees every retrieved chunk at once and marks which ones actually help answer this question. precision = (chunks marked relevant) / (chunks retrieved). No live recall/F1 - that needs the total count of relevant documents that exist, which is unknowable outside the golden dataset.",
                  implemented: true,
                }}
              />
            </span>
            {message.explainability?.eval_scores?.retrieval_precision !== null &&
            message.explainability?.eval_scores?.retrieval_precision !== undefined ? (
              <>
                <p>
                  Precision: {message.explainability.eval_scores.retrieval_precision.toFixed(2)} - chunk(s){" "}
                  {message.explainability.eval_scores.retrieval_relevant_chunk_indices.join(", ") || "none"} relevant
                </p>
                {message.explainability.eval_scores.retrieval_precision_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.retrieval_precision_explanation}</pre>
                )}
              </>
            ) : (
              <p className="dev-note-inline">Not available (no retrieved context, or served from cache).</p>
            )}
          </div>
          <div className="panel panel-info">
            <span className="panel-eyebrow">Golden dataset reference (offline only)</span>
            <ul className="citation-list">
              <li>Precision@5: 0.200 &middot; Recall@5: 1.000 &middot; F1: 0.333 (25 cases, 2026-10-17)</li>
            </ul>
            <p className="dev-note-inline">
              Precision is capped at 1/k by design (1 labeled document per case) - recall is what actually gates a
              release (minimum 0.6). <code>scripts/run_release_gate.py</code>.
            </p>
          </div>
          </div>
        )}

        {activeTab === "responseEval" && (
          <div className="explainability-tab-panel">
          {message.explainability?.eval_scores ? (
            <div
              className={
                message.explainability.eval_scores.groundedness_verdict === "GROUNDED" &&
                message.explainability.eval_scores.completeness_verdict === "COMPLETE"
                  ? "panel panel-success"
                  : "panel panel-warning"
              }
            >
              <span className="panel-eyebrow">Response Generation Eval Score</span>

              <div className="eval-score-group">
                <span className="eval-score-group-label">Groundedness</span>
                <p>
                  {message.explainability.eval_scores.groundedness.toFixed(2)} - {message.explainability.eval_scores.groundedness_verdict}
                </p>
                <p className="dev-note-inline">Is the answer supported by the retrieved context, or does it hallucinate?</p>
                {message.explainability.eval_scores.groundedness_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.groundedness_explanation}</pre>
                )}
              </div>

              <div className="eval-score-group">
                <span className="eval-score-group-label">Completeness</span>
                <p>
                  {message.explainability.eval_scores.completeness.toFixed(2)} - {message.explainability.eval_scores.completeness_verdict}
                </p>
                <p className="dev-note-inline">Does the answer fully address what was asked?</p>
                {message.explainability.eval_scores.completeness_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.completeness_explanation}</pre>
                )}
              </div>

              <div className="eval-score-group">
                <span className="eval-score-group-label">How this was calculated</span>
                <ul className="citation-list">
                  <li>
                    A judge LLM scores each dimension 0-10 (normalized above), given the question, answer, and
                    context - its raw response is shown verbatim under each score.
                  </li>
                  <li>
                    Hand-rolled LLM-as-judge prompts (IK FDE Module 5 pattern), not DeepEval
                    {message.explainability.latency_ms.eval !== null && ` - ${message.explainability.latency_ms.eval.toFixed(0)}ms`}.
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="panel panel-warning">
              <span className="panel-eyebrow">Response Generation Eval Score</span>
              <p>Not available for this message (no retrieved context to check groundedness against).</p>
            </div>
          )}
          </div>
        )}

        {activeTab === "engineeringTrace" && (() => {
          const mode = detectPipelineMode(message);
          const turns = message.explainability?.llm_context?.turns ?? [];
          const sources = message.sources ?? [];
          const distinctDocuments = new Set(sources.map((source) => source.filename));
          const iterationCount = turns.filter((turn) => turn.label.startsWith("iteration ")).length;

          const loopEngineering =
            mode === "multi-agentic-rag"
              ? `No loop - one-shot parallel fan-out to ${message.tasks?.length ?? 0} agent(s), then a single Reviewer merge.`
              : mode === "single-agentic-rag"
                ? `Real ReAct loop - ${iterationCount} iteration(s) this call (max 5 by default). See the ReAct Flow tab for the per-iteration breakdown.`
                : `No loop - a single retrieve-then-generate call${turns.length > 1 ? ` (${turns.length} decomposed sub-questions, each its own call)` : ""}.`;

          const harnessEngineering =
            mode === "multi-agentic-rag"
              ? "LangGraph StateGraph - 7 real nodes (planner, 5 domain agents, reviewer), parallel dispatch via LangGraph's own Send() API. ai/agents/workflow_agents/multi_agent_pipeline.py."
              : mode === "single-agentic-rag"
                ? "A plain Python for loop, not a graph framework - calls the LLM with bound tools each iteration until it stops calling them or hits max_iterations. ai/agents/workflow_agents/orchestration_agent.py."
                : "A single direct function call - no loop, no graph framework. ai/rag_pipeline/pipeline.py.";

          return (
            <div className="explainability-tab-panel">
              <p className="dev-note-inline">
                A synthesis view, not a duplicate of LLM Context's raw prompt/response text - cross-references which
                real backend code produced this answer.
              </p>
              <div className="explainability-row">
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Prompt Engineering</span>
                  {turns.length === 0 ? (
                    <p className="dev-note-inline">No LLM call captured for this answer.</p>
                  ) : (
                    <table className="explainability-data-table">
                      <tbody>
                        {turns.map((turn, index) => (
                          <tr key={`${turn.label}-${index}`}>
                            <th>{turn.label}</th>
                            <td className="dev-note-inline">{promptConstantForTurn(turn.label, mode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Context Engineering</span>
                  <ul className="citation-list">
                    <li>{sources.length} chunk(s) retrieved</li>
                    <li>{distinctDocuments.size} distinct source document(s)</li>
                    <li className="dev-note-inline">
                      Assembled by {mode === "multi-agentic-rag" ? "build_context_from_agent_results()" : "build_context_from_chunks()"}
                    </li>
                  </ul>
                </div>
              </div>
              <div className="explainability-row">
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Loop Engineering</span>
                  <p className="dev-note-inline">{loopEngineering}</p>
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Harness Engineering</span>
                  <p className="dev-note-inline">{harnessEngineering}</p>
                </div>
              </div>
            </div>
          );
        })()}

        {activeTab === "llmContext" && (
          <div className="explainability-tab-panel">
          {llmContext ? (
            <>
              {llmContext.turns.length === 0 && llmContext.mcp_tool_calls.length === 0 && (
                <p>Nothing captured for this answer.</p>
              )}
              {llmContext.turns.map((turn, index) => {
                // Phase 140: the reviewer-merge turn isn't a sub-question -
                // it's the extra LLM call that combines the other turns'
                // answers into one response. Badge it "Merge" instead of
                // "Q{n}" and skip the "Question:" line (there isn't one),
                // matching the label convention pipeline.py writes
                // ("Merging N sub-answers into one response").
                const isMergeTurn = turn.label.startsWith("Merging ");
                return (
                <CollapsibleSection
                  key={`${turn.label}-${index}`}
                  nested
                  defaultOpen={llmContext.turns.length === 1}
                  title={
                    <>
                      <span className="kb-chunk-sequence">{isMergeTurn ? "Merge" : `Q${index + 1}`}</span> {turn.label}
                    </>
                  }
                >
                  {!isMergeTurn && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Question:</span>
                      <p>{turn.label}</p>
                    </div>
                  )}
                  {turn.chat_history.length > 0 && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Chat history sent:</span>
                      <pre className="llm-context-pre">
                        {turn.chat_history.map((m) => `[${m.role}] ${m.content}`).join("\n")}
                      </pre>
                    </div>
                  )}
                  {turn.system_prompt && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">System prompt:</span>
                      <pre className="llm-context-pre">{turn.system_prompt}</pre>
                    </div>
                  )}
                  {turn.human_message && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Human message:</span>
                      <pre className="llm-context-pre">{turn.human_message}</pre>
                    </div>
                  )}
                  {turn.system_prompt === null && turn.human_message === null && !isMergeTurn && (
                    <p className="dev-note-inline">Prompt not captured for this turn.</p>
                  )}
                  {isMergeTurn && (
                    <p className="dev-note-inline">
                      A separate LLM call combining the other turns' answers into one response - its own prompt isn't captured yet, only its output below.
                    </p>
                  )}
                  {turn.response && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Response:</span>
                      <pre className="llm-context-pre">{turn.response}</pre>
                    </div>
                  )}
                  {!isMergeTurn && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Response KB source:</span>
                      {llmContext.turns.length === 1 && sources.length > 0 ? (
                        <ul className="citation-list">
                          {sources.map((source) => (
                            <li key={chunkKey(source)}>
                              {source.filename}, chunk {source.chunk_index}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="dev-note-inline">
                          {sources.length === 0
                            ? "No chunks retrieved for this answer."
                            : "Per-sub-question chunk attribution isn't tracked yet - see Citations below for the full retrieved set across all sub-questions."}
                        </p>
                      )}
                    </div>
                  )}
                </CollapsibleSection>
                );
              })}
              {llmContext.mcp_tool_calls.map((call, index) => (
                <CollapsibleSection
                  key={`${call.tool_name}-${index}`}
                  nested
                  defaultOpen={llmContext.turns.length === 0}
                  title={
                    <>
                      <span className="kb-chunk-sequence">Q{llmContext.turns.length + index + 1}</span> MCP: {call.tool_name}
                    </>
                  }
                >
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Arguments:</span>
                    <pre className="llm-context-pre">{JSON.stringify(call.arguments, null, 2)}</pre>
                  </div>
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Raw result:</span>
                    <pre className="llm-context-pre">{call.raw_result.join("\n")}</pre>
                  </div>
                </CollapsibleSection>
              ))}
            </>
          ) : (
            <div className="panel panel-warning">
              <p>
                Not tracked for this pipeline mode yet (genai-rag only so far - see RAG-ROADMAP.md Phase 132), or
                this answer was served from cache (nothing was actually sent this call).
              </p>
            </div>
          )}
          </div>
        )}

        {activeTab === "techStack" && (
          <div className="explainability-tab-panel">
          <p className="dev-note-inline">
            Real versions read from requirements.txt (hrb_chatbot_v2) and package.json (hrb_chatbot_ui) as of
            2026-10-17 - static, same for every query. Will go stale after a dependency bump; not auto-synced.
          </p>
          {TECH_STACK_GROUPS.map((group) => (
            <div className="panel panel-info" key={group.label}>
              <span className="panel-eyebrow">{group.label}</span>
              <table className="explainability-data-table">
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.name}>
                      <th>{item.name}</th>
                      <td>{item.version}</td>
                      <td className="dev-note-inline">{item.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          </div>
        )}

        {activeTab === "citations" && (
          <div className="explainability-tab-panel">
          <div className="panel panel-success">
            <span className="panel-eyebrow">User Query</span>
            <p className="kb-query-text">{originalQuery ?? "Not available for this message."}</p>
          </div>

          <div className="panel panel-info">
            <span className="panel-eyebrow">User Profile</span>
            {identity ? (
              <ul className="citation-list">
                <li>Employee ID: {identity.employee_id}</li>
                <li>Name: {identity.full_name}</li>
                <li>Role: {identity.role}</li>
              </ul>
            ) : (
              <p>Not signed in.</p>
            )}
          </div>

          <div className="panel panel-success">
            <span className="panel-eyebrow">Retrieved Chunks ({sources.length})</span>
            {sources.length > 0 ? (
              <ol className="kb-chunk-list">
                {sources.map((source, index) => (
                  <li key={chunkKey(source)}>
                    <button
                      type="button"
                      className={selectedChunkKey === chunkKey(source) ? "link-button citation-link-active" : "link-button"}
                      onClick={() => setSelectedChunkKey(selectedChunkKey === chunkKey(source) ? null : chunkKey(source))}
                    >
                      <span className="kb-chunk-sequence">#{index + 1}</span> {source.filename}, chunk{" "}
                      {source.chunk_index}
                      {source.score !== null && <span> - score {source.score.toFixed(3)}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No sources recorded for this message.</p>
            )}
          </div>

          {selectedChunk && (
            <div className="panel panel-info">
              <span className="panel-eyebrow">Chunk Detail</span>
              <table className="kb-chunk-grid">
                <tbody>
                  <tr>
                    <th>Filename</th>
                    <td>{selectedChunk.filename}</td>
                  </tr>
                  <tr>
                    <th>Document ID</th>
                    <td>{selectedChunk.document_id}</td>
                  </tr>
                  <tr>
                    <th>Chunk index</th>
                    <td>{selectedChunk.chunk_index}</td>
                  </tr>
                  <tr>
                    <th>Score</th>
                    <td>{selectedChunk.score !== null ? selectedChunk.score.toFixed(3) : "n/a (MMR/MultiQuery result)"}</td>
                  </tr>
                  <tr>
                    <th>Eval score</th>
                    <td>
                      {message.explainability?.eval_scores
                        ? `Groundedness ${message.explainability.eval_scores.groundedness.toFixed(2)}, Completeness ${message.explainability.eval_scores.completeness.toFixed(2)} (answer-level - no per-chunk eval score is computed)`
                        : "Not available for this message."}
                    </td>
                  </tr>
                  {message.retrievalInfo && (
                    <tr>
                      <th>Retrieval metadata</th>
                      <td>
                        {message.retrievalInfo.vector_db} / {message.retrievalInfo.search_strategy}
                        {message.retrievalInfo.applied_filter
                          ? ` - filter: ${JSON.stringify(message.retrievalInfo.applied_filter)}`
                          : ""}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="llm-context-block">
                <span className="dev-note-inline">Chunk text:</span>
                <pre className="llm-context-pre">{selectedChunk.text}</pre>
              </div>
            </div>
          )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
