import { useEffect, useState, type ReactNode } from "react";
import { getDocument } from "../api/client";
import { RESPONSE_METRIC_GUIDANCE, RETRIEVAL_METRIC_GUIDANCE } from "../constants/evalMetricGuidance";
import { useIdentity } from "../context/IdentityContext";
import HelpPopover from "./HelpPopover";
import type { ActivatedRailInfo, ChatMessage, RetrievedChunk, ToolCallInfo } from "../types";

interface ExplainabilityModalProps {
  message: ChatMessage;
  originalQuery: string | null;
  onClose: () => void;
}

// Phase 216 - GET .../documents/{id} (used for per-source chunking
// strategy) is gated to these 3 roles backend-side
// (api/rag/ingest_document.py) - mirrored here so an employee/manager
// never fires a call that would just 403.
const PRIVILEGED_DOCUMENT_ROLES = new Set(["hr_support", "admin", "employee_admin"]);

// Phase 218 - same expanded-acronym labels as ChatPage.tsx's own
// SEARCH_STRATEGY_LABELS (not imported from there - that file has no
// shared-constants module to import from yet, and this is plain display
// text, not logic). Falls back to the raw value for any future
// search_strategy this map doesn't know about yet.
const SEARCH_STRATEGY_DISPLAY_LABELS: Record<string, string> = {
  similarity: "Semantic Search - ANN (Approximate Nearest Neighbor) via HNSW",
  mmr: "MMR (Maximal Marginal Relevance)",
  keyword: "Keyword (BM25)",
  hybrid: "Hybrid (Keyword + Semantic)",
  knn: "Exact KNN (K-Nearest Neighbors, brute-force)",
};

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

function ResponseMetricIcon({ metric, label }: { metric: keyof typeof RESPONSE_METRIC_GUIDANCE; label: string }) {
  const guidance = RESPONSE_METRIC_GUIDANCE[metric];
  return (
    <InfoIcon
      info={{
        label,
        description: (
          <>
            <HelpSection heading="What it means">{guidance.what}</HelpSection>
            <HelpSection heading="Why it can look low">{guidance.why}</HelpSection>
            <HelpSection heading="How to tune it" items={guidance.tune} />
          </>
        ),
        implemented: true,
      }}
    />
  );
}

// Phase 223 - a below-threshold metric gets an ACTIVE, visible
// recommendation (not just a hover tooltip) - reuses the exact same
// guidance text either metric-icon component already shows on hover, so
// there's one source of truth for the tuning advice, just surfaced two ways.
const BELOW_THRESHOLD_METRIC_LABELS: Record<string, string> = {
  retrieval_precision: "Precision",
  groundedness: "Groundedness",
  completeness: "Completeness",
};

// 2026-10-19 - dynamic, not just a static copy of the hover-help text:
// drops a suggestion that this specific answer's own real settings
// already ruled out, instead of unconditionally repeating it every time.
// Scoped to what's genuinely knowable from the response with no backend
// change - search_strategy/sources.length/temperature are all real
// fields already in ExplainabilityInfo/RetrievalInfo today, not new
// plumbing. Each condition only ever REMOVES a now-irrelevant line, never
// invents a new one and never edits the wording of one that stays - the
// underlying guidance text is still the single source of truth.
const PLATFORM_MAX_TOP_K = 20; // SearchOptions.top_k's own le=20 ceiling (models/rag.py)

function dynamicTune(tune: string[], message: ChatMessage): string[] {
  const searchStrategy = message.retrievalInfo?.search_strategy;
  const sourceCount = message.sources?.length ?? 0;
  const temperature = message.explainability?.temperature;

  const filtered = tune.filter((item) => {
    if (item.includes('"Hybrid"') && searchStrategy === "hybrid") return false;
    if (item.includes('"MMR"') && searchStrategy === "mmr") return false;
    if (item.includes('"Top K"') && item.toLowerCase().startsWith("raise") && sourceCount >= PLATFORM_MAX_TOP_K) {
      return false;
    }
    if (item.includes('"Temperature"') && temperature !== null && temperature !== undefined && temperature <= 0.1) {
      return false;
    }
    return true;
  });
  // Never show nothing - if every line happened to get filtered, the
  // original (possibly-redundant) guidance is still better than a blank
  // Recommendations panel for a flagged metric.
  return filtered.length > 0 ? filtered : tune;
}

function BelowThresholdRecommendations({
  belowThresholdMetrics,
  threshold,
  guidance,
  message,
}: {
  belowThresholdMetrics: string[];
  threshold: number | undefined;
  guidance: Record<string, { what: string; tune: string[] }>;
  message: ChatMessage;
}) {
  const flagged = belowThresholdMetrics.filter((metric) => metric in guidance);
  if (flagged.length === 0) {
    return null;
  }
  return (
    <div className="panel panel-warning">
      <span className="panel-eyebrow">
        Recommendations{threshold !== undefined && ` - below your threshold of ${threshold.toFixed(2)}`}
      </span>
      {flagged.map((metric) => (
        <div className="eval-score-group" key={metric}>
          <span className="eval-score-group-label">{BELOW_THRESHOLD_METRIC_LABELS[metric] ?? metric}</span>
          <ul className="citation-list">
            {dynamicTune(guidance[metric].tune, message).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RetrievalMetricIcon({ metric, label }: { metric: keyof typeof RETRIEVAL_METRIC_GUIDANCE; label: string }) {
  const guidance = RETRIEVAL_METRIC_GUIDANCE[metric];
  return (
    <InfoIcon
      info={{
        label,
        description: (
          <>
            <HelpSection heading="What it means">{guidance.what}</HelpSection>
            <HelpSection heading="Why it can look low">{guidance.why}</HelpSection>
            <HelpSection heading="How to tune it" items={guidance.tune} />
          </>
        ),
        implemented: true,
      }}
    />
  );
}

// Agent model (user-requested, this conversation): the 3 workflow agents
// every multi-agentic-rag query goes through, plus all 5 domain agents the
// backend code actually defines - 2 of which (sql_db_agent/lms_analytics_agent)
// are non-functional stubs today, shown rather than hidden so the panel
// stays honest about what's real vs. placeholder, same spirit as this
// project's existing "Dollar cost intentionally out of scope" notes.
interface AgentInfo {
  label: string;
  // ReactNode, not just string - lets a call site pass structured,
  // formatted sections (HelpSection below) instead of one run-on sentence.
  description: ReactNode;
  implemented: boolean;
}

// A labeled sub-section inside a "?" popover - "What it means"/"Why it can
// look low"/"How to tune it", real paragraph structure instead of one flat
// concatenated string. Plain text still works fine as a bare description
// (see AgentInfo.description above) - this is only for the handful of
// call sites with genuinely multi-part guidance. `items` (2026-10-19,
// user-reported) renders real bullet points instead of a "·"-joined
// run-on sentence - a wall of prose made these popovers tall and hard to
// scan; takes precedence over `children` when given.
function HelpSection({ heading, children, items }: { heading?: string; children?: ReactNode; items?: string[] }) {
  return (
    <div className="help-popover-section">
      {heading && <span className="help-popover-section-heading">{heading}</span>}
      {items ? (
        <ul className="citation-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{children}</p>
      )}
    </div>
  );
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
    description: "Searches the indexed HR benefits documents (401k, healthcare, tuition, leave policies) using vector similarity search - the same knowledge base Reflex RAG's own retrieval uses.",
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

// 2026-10-18 - thin wrapper over the app-wide HelpPopover (click-pinned,
// explicit close, Copy button, portal-rendered) - kept as its own named
// component so the ~16 call sites below didn't all need to change shape,
// just this one definition.
function InfoIcon({ info }: { info: AgentInfo }) {
  const suffix = info.implemented ? "" : " (not implemented yet)";
  return (
    <HelpPopover label={info.label} variant={info.implemented ? "default" : "muted"}>
      {typeof info.description === "string" ? (
        <p>
          {info.description}
          {suffix}
        </p>
      ) : (
        <>
          {info.description}
          {suffix && <p>{suffix}</p>}
        </>
      )}
    </HelpPopover>
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

// Phase 3 - 2-level tab tree, replacing the old flat 10-tab row (kept as
// one flat row until this phase - see the phase history on each rename
// below for the real design trail, not invented after the fact). Phase 4
// round 2 - the original 3-level version wrapped "Retrieval"/"Response
// Generation" in a "Retrieval & Response" parent tab that added a click
// for no real benefit (the parent had no content of its own) - user-
// reported, removed: those 2 are now top-level tabs directly.
type ExplainTopTab =
  | "retrieval"
  | "responseGeneration"
  | "cacheOptimization"
  | "techStack"
  | "testingStrategy"
  | "platformArchitecture";
type ExplainRetrievalLeaf = "kbRetrieval" | "citations" | "retrievalScore";
type ExplainResponseLeaf =
  | "agentRouting"
  | "llmContext"
  | "evalsScore"
  | "metrics"
  | "guardrails"
  | "engineeringTrace";
// Phase 17 - user-requested, for professional reviewers: this project's
// own 3-dataset RAG-quality testing strategy, condensed from
// hrb_chatbot_service's docs/agent-reference/testing-strategies.md (the
// authoritative source - every fact here traces back to it or the real
// code it cites, nothing invented for this tab).
type ExplainTestingStrategyLeaf = "goldenDataset" | "syntheticDataset" | "liveQueries" | "langsmith";
// Phase 17 - the platform-wide picture (ingestion depth + real production
// incidents), condensed from this session's own RAG Ingestion doc set and
// RAG-ROADMAP.md's Phase 278/280 entries.
type ExplainPlatformArchitectureLeaf = "ragIngestion" | "productionIncidents";

const EXPLAIN_TOP_ORDER: ExplainTopTab[] = [
  "retrieval",
  "responseGeneration",
  "cacheOptimization",
  "techStack",
  "testingStrategy",
  "platformArchitecture",
];
// Metrics/Guardrails/Engineering Trace are genuinely cross-cutting (not
// purely retrieval- or generation-specific) - placed under Response
// Generation rather than split further, since splitting their actual
// content (not just moving tabs) was past what was asked.
const EXPLAIN_TOP_LABELS: Record<ExplainTopTab, string> = {
  retrieval: "Retrieval",
  responseGeneration: "Response Generation",
  // 2026-10-20 - user-requested: its own tab, "Caching" as the first child
  // sub-tab (room for more optimization techniques - rate limiting,
  // parallel tool calls - to join as sibling sub-tabs later). Phase 3 -
  // renamed "Optimization" -> "Cache Optimization" (accurate, not
  // cosmetic - this tab is 100% cache hit/miss content today).
  cacheOptimization: "Cache Optimization",
  techStack: "Tech Stack",
  testingStrategy: "Testing Strategy",
  platformArchitecture: "Platform Architecture",
};

const EXPLAIN_TESTING_STRATEGY_LEAF_ORDER: ExplainTestingStrategyLeaf[] = [
  "goldenDataset",
  "syntheticDataset",
  "liveQueries",
  "langsmith",
];
const EXPLAIN_TESTING_STRATEGY_LEAF_LABELS: Record<ExplainTestingStrategyLeaf, string> = {
  goldenDataset: "Golden Dataset",
  syntheticDataset: "Synthetic Dataset",
  liveQueries: "Live Queries",
  langsmith: "LangSmith",
};

const EXPLAIN_PLATFORM_ARCHITECTURE_LEAF_ORDER: ExplainPlatformArchitectureLeaf[] = [
  "ragIngestion",
  "productionIncidents",
];
const EXPLAIN_PLATFORM_ARCHITECTURE_LEAF_LABELS: Record<ExplainPlatformArchitectureLeaf, string> = {
  ragIngestion: "RAG Ingestion",
  productionIncidents: "Production Incidents",
};

// 2026-10-18 - "Retrieval Strategy" was its own tab rather than a line in
// Metrics since more retrieval/ingestion-config attributes were planned to
// join it. Phase 3 - renamed "Retrieval Strategy" -> "KB Retrieval".
const EXPLAIN_RETRIEVAL_LEAF_ORDER: ExplainRetrievalLeaf[] = ["kbRetrieval", "citations", "retrievalScore"];
const EXPLAIN_RETRIEVAL_LEAF_LABELS: Record<ExplainRetrievalLeaf, string> = {
  kbRetrieval: "KB Retrieval",
  citations: "Citations",
  // Split out of the old merged "Eval Score" tab (2026-10-19 - "Retrieval
  // Eval Score"/"Response Generation Eval Score" had been merged into one
  // parent tab with an internal pill switch; Phase 3 undoes that merge
  // now that each half has its own place in the new 3-level tree - a
  // content-faithful split, not new content).
  retrievalScore: "Retrieval Score",
};

const EXPLAIN_RESPONSE_LEAF_ORDER: ExplainResponseLeaf[] = [
  "metrics",
  "agentRouting",
  "llmContext",
  "evalsScore",
  "guardrails",
  "engineeringTrace",
];
const EXPLAIN_RESPONSE_LEAF_LABELS: Record<ExplainResponseLeaf, string> = {
  metrics: "Metrics",
  // Was "Agent Flow", Phase 3 round 1 renamed to "Response Generation" -
  // then round 3 renamed again to "Agent Routing" once "Response
  // Generation" became the new mid-level category name instead (a real
  // naming collision, resolved by renaming the content tab, not the
  // category).
  agentRouting: "Agent Routing",
  llmContext: "LLM Context",
  // Phase 3 round 3 - renamed from "Response Generation Score" (its
  // "Retrieval Score" sibling keeps that name; this asymmetric naming
  // was requested explicitly, not an oversight).
  evalsScore: "Evals Score",
  // Phase 224 - real per-answer NeMo Guardrails (Input/Output) status, not
  // a static description of what guardrails exist. 2026-10-19 round 2 -
  // expanded from NeMo-only to all 6 of this project's own validation
  // gates - tab label kept as "Guardrails" even though the content now
  // covers all 6 gates, not just NeMo's.
  guardrails: "Guardrails",
  engineeringTrace: "Engineering Trace",
};

// Phase 224 - real NeMo Guardrails rail names (nemoguardrails config under
// ai/guardrails_config), not display guesses - mapped to a short, plain-
// language explanation of what each one actually checks for. Phase 229 -
// corrected to the REAL rail names, live-verified against the actual
// config (3 real calls - pass/masked/blocked) rather than the plausible-
// sounding but never-live-checked "pii detection" placeholder this used
// before - the real masking rails are named "mask sensitive data on
// input"/"...on output", confirmed in NeMo's own activated_rails log.
const GUARDRAIL_RAIL_DESCRIPTIONS: Record<string, string> = {
  "self check input": "Another AI reads your question first and checks whether it looks like an attempt to trick or misuse the system.",
  "self check output": "Another AI reads the answer before it's sent back and checks whether it's safe to show you.",
  "mask sensitive data on input": "Checks your question for personal information (like a social security number or email address) and masks it out.",
  "mask sensitive data on output": "Checks the AI's answer for personal information (like a social security number or email address) and masks it out before it's shown.",
};

// Phase 229 - user-requested: what DATA each validation actually looks at
// (your typed question vs. the AI's generated answer) and what kind of
// problem it's checking for - real distinctions grounded in this
// project's own config.yml (input rails run before retrieval ever
// starts; output rails run on the generated answer before it's sent
// back), not generic RAG security copy.
const GUARDRAIL_RAIL_WHAT_IT_CHECKS: Record<string, string> = {
  "self check input": "Your typed question - prompt injection / jailbreak attempts",
  "mask sensitive data on input": "Your typed question - personal information (SSN, email, credit card, names)",
  "self check output": "The AI's generated answer - unsafe or inappropriate content",
  "mask sensitive data on output": "The AI's generated answer - personal information (SSN, email, credit card, names)",
};

function guardrailRailDescription(rail: string | null): string {
  if (!rail) return "";
  return GUARDRAIL_RAIL_DESCRIPTIONS[rail] ?? `A NeMo Guardrails rail named "${rail}".`;
}

// Phase 225 - groundedness_explanation/completeness_explanation already
// carry the judge LLM's raw "Score: X\nReasoning: ..." response verbatim
// (golden_dataset_harness.py's own `explanation: output`) - the raw 0-10
// score and the score/10 normalization were already real data, just
// buried inside a prose blob instead of shown as the calculation itself.
function parseJudgeRawScore(explanation: string | null): string | null {
  if (!explanation) return null;
  const match = explanation.match(/Score:\s*([\d.]+)/);
  if (!match) return null;
  const raw = Number(match[1]);
  if (Number.isNaN(raw)) return null;
  return `${raw}/10 = ${(raw / 10).toFixed(2)}`;
}

type GuardrailGateId = "gate1" | "gate2" | "gate3" | "gate4" | "gate5" | "gate6";

// 2026-10-19 round 2 - the Validation Gateway tab's own 6-gate selector,
// matching docs/dev-reference/rag-pipeline-status.md's real gate names.
const GUARDRAIL_GATES: { id: GuardrailGateId; label: string }[] = [
  { id: "gate1", label: "Gate 1 · Input Firewall" },
  { id: "gate2", label: "Gate 2 · Access Control" },
  { id: "gate3", label: "Gate 3 · Retrieval Strategy" },
  { id: "gate4", label: "Gate 4 · Context Grade" },
  { id: "gate5", label: "Gate 5 · Grounding" },
  { id: "gate6", label: "Gate 6 · Delivery" },
];

// 2026-10-20 - the real caching techniques this project has actually
// built, user-requested as their own "?"-documented tab. Grounded
// directly in each cache client's own docstring, not generic caching
// advice - common/clients/cache_client/answer_cache.py,
// common/clients/cache_client/embedding_cache.py, and
// common/clients/auth_client/oauth_client.py's module-level token cache.
// Round 2, user-requested: broadened past this project's own 3 to the
// wider set of caching techniques worth knowing for interview purposes,
// even the ones not built here - each one says plainly whether it's
// real/live in this project or not, never blurs the two.
type CachingTechniqueId =
  | "answerCache"
  | "embeddingCache"
  | "tokenCache"
  | "redis"
  | "cdnCache"
  | "kvCache"
  | "semanticCache"
  | "promptCache";
const CACHING_TECHNIQUES: {
  id: CachingTechniqueId;
  label: string;
  implemented: boolean;
  what: string;
  mechanism: string;
  scope: string;
}[] = [
  {
    id: "answerCache",
    label: "Answer Cache",
    implemented: true,
    what: "Caches a full answer (text + sources + explainability data) so an identical question doesn't re-run retrieval and generation.",
    mechanism: "Redis-backed, exact-match only - keyed by a hash of the question plus every setting that could change the answer (never who asked, so the same policy question gets the same cached answer for everyone). 6-hour expiry, and cleared immediately whenever a document changes, so an edited policy is never served stale from cache.",
    scope: "genai-rag only - not single/multi-agentic-rag, since a tool-driven answer (e.g. a live leave balance) can depend on data that changes between requests. Real code, but production currently has no REDIS_URL configured (confirmed via the live /health check, which lists no Redis entry at all) - the client fails open, so this degrades to \"no caching\" in production today, not a broken request.",
  },
  {
    id: "embeddingCache",
    label: "Embedding Cache",
    implemented: true,
    what: "Avoids re-generating the embedding vector for a chunk of text that hasn't actually changed.",
    mechanism: "Redis-backed, exact-match on (content hash, embedding model) - if the same chunk text gets re-indexed with the same model, the embedding is reused instead of calling the embedding model again. 30-day expiry (long, since a given content hash's embedding never changes - the cache only ever goes stale if the content itself changes, which gives it a new hash).",
    scope: "Document ingestion only - no effect on chat response time. Same real-but-not-live-in-production caveat as the Answer Cache above - no REDIS_URL configured there today.",
  },
  {
    id: "tokenCache",
    label: "OAuth2 Token Cache",
    implemented: true,
    what: "Avoids re-authenticating with hrb_lms_mcp on every single tool call.",
    mechanism: "In-process (a plain module-level variable, not Redis) - a Bearer token is requested once, then reused for every call until it's about to expire (a 30-second safety margin before the real expiry), at which point a fresh one is requested automatically.",
    scope: "Any pipeline that calls hrb_lms_mcp's MCP tools (leave balance/history, HITL review). Per-process, not shared across App Runner instances - each running instance keeps its own cached token. Unlike the 2 above, this one doesn't depend on Redis at all, so it's genuinely live in production.",
  },
  {
    id: "redis",
    label: "Redis (the underlying technology)",
    implemented: true,
    what: "An in-memory key-value store - the actual caching technology behind the Answer Cache and Embedding Cache above. Not a cache technique on its own, it's the infrastructure both of those are built on top of.",
    mechanism: "Stores data in RAM, not disk, so reads/writes are extremely fast compared to a real database round-trip. Supports a native per-key expiry (TTL), which is exactly how both caches above auto-expire old entries without a separate cleanup job. Every value in both caches here is plain JSON, decoded on read.",
    scope: "Configured via REDIS_URL. Locally this can point at a real Redis instance; in production, the real/planned path is AWS ElastiCache (see docs/dev-reference/deployment-guide/04-redis-cache.html) - provisioning that is still a planning doc, not done, which is exactly why production has no REDIS_URL set today.",
  },
  {
    id: "cdnCache",
    label: "CDN / Edge Cache (CloudFront)",
    implemented: true,
    what: "Caches the built frontend's static files (HTML/JS/CSS) at edge locations close to the browser, so a repeat visitor doesn't re-download them from S3 on every load.",
    mechanism: "AWS CloudFront sits in front of the S3 bucket hosting hrb_chatbot_ui's build output. A deploy explicitly invalidates the cache (aws cloudfront create-invalidation --paths \"/*\") so the new build is served immediately instead of waiting for the old cached version's TTL to expire.",
    scope: "Frontend only - a genuinely different kind of caching than everything else on this page (static assets at the network edge, not application data in Redis).",
  },
  {
    id: "kvCache",
    label: "KV Cache",
    implemented: false,
    what: "Inside a transformer model, generating each new token normally means recomputing attention over every token that came before it. The KV (key-value) cache stores those per-token key/value vectors once, so generating token N+1 reuses token N's already-computed values instead of redoing that work from scratch.",
    mechanism: "This is an inference-engine-level optimization (inside the model server itself), not something an application calling a hosted API can implement or control.",
    scope: "Not applicable here - this project calls OpenAI/Anthropic's hosted APIs, where KV caching (if used) happens entirely inside their own inference infrastructure, invisible to this codebase. Included because it's a common interview topic for anyone asked about LLM inference performance, not because it's something this project built.",
  },
  {
    id: "semanticCache",
    label: "Semantic Cache",
    implemented: false,
    what: "A cache hit on a semantically similar question, not just an identical one - e.g. \"how many PTO days do I get\" and \"what's my paid time off balance\" could both hit the same cached answer, by comparing embedding similarity instead of exact text.",
    mechanism: "Would need a vector similarity lookup against previously-cached questions (a small, separate vector index just for cache keys) plus a similarity threshold decision, instead of this project's current exact-match hash lookup.",
    scope: "Not built here - the real Answer Cache above is exact-match only, by design (see its own scope note). This is the natural next step beyond it, and a common follow-up question once exact-match caching comes up in an interview.",
  },
  {
    id: "promptCache",
    label: "Prompt / Context Caching",
    implemented: false,
    what: "Some LLM providers (Anthropic's prompt caching, OpenAI's automatic caching of repeated prompt prefixes) cache the processed representation of a long, repeated prefix - like a system prompt or a large retrieved-context block - so paying the full compute cost for it only happens once, not on every request that reuses it.",
    mechanism: "Provider-managed - enabled via specific API parameters/headers (Anthropic) or automatic above a length threshold (OpenAI), not something this project implements itself.",
    scope: "Not explicitly used here - this project's own LLM client wrappers don't opt into either provider's prompt-caching feature today, even though the system prompts and retrieved context sent on every request would be a natural fit for it.",
  },
];

function guardrailStatusLabel(status: "pass" | "modified" | "blocked"): string {
  if (status === "pass") return "Pass";
  if (status === "modified") return "Modified";
  return "Blocked";
}

function GuardrailCheckPanel({
  title,
  check,
  blockedNote,
}: {
  title: string;
  check: { status: "pass" | "modified" | "blocked"; rail: string | null; activated_rails: ActivatedRailInfo[] };
  blockedNote?: string;
}) {
  return (
    <div className={check.status === "pass" ? "panel panel-success" : "panel panel-warning"}>
      <span className="panel-eyebrow">{title}</span>
      <p className="eval-score-value">{guardrailStatusLabel(check.status)}</p>
      {check.rail ? (
        <p className="eval-score-caption">
          Caught by: "{check.rail}" - {guardrailRailDescription(check.rail)}
        </p>
      ) : (
        <p className="eval-score-caption">Nothing was flagged - the text passed every check unchanged.</p>
      )}
      {check.status === "blocked" && blockedNote && <p className="eval-score-caption">{blockedNote}</p>}
      {/* Phase 229 - real evidence of which specific validations ran for
          THIS answer, not just the aggregate verdict above - every
          configured rail shows up here, including ones that found
          nothing wrong, with NeMo's own real logged actions (not a
          summary we wrote). Round 2 - each validation's name now has its
          own "?" (user-requested), and the column header explains, once,
          that the log column is verbatim system output, not a paraphrase
          - keeps every row's own text short and simple. */}
      {check.activated_rails.length > 0 && (
        <>
          <span className="eval-score-group-label">Validations that ran</span>
          <table className="explainability-data-table">
            <thead>
              <tr>
                <th>Validation</th>
                <th>What's checked</th>
                <th>
                  What happened{" "}
                  <HelpPopover label="What happened - column">
                    <p>
                      This is the system's own exact internal log of what this validation did, word for word - not
                      a summary written for this screen. It's shown as real proof the check actually ran.
                    </p>
                  </HelpPopover>
                </th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {check.activated_rails.map((rail) => (
                <tr key={rail.name}>
                  <td className="dev-note-inline">
                    {rail.name}{" "}
                    <HelpPopover label={rail.name}>
                      <p>{GUARDRAIL_RAIL_DESCRIPTIONS[rail.name] ?? `A validation named "${rail.name}".`}</p>
                    </HelpPopover>
                  </td>
                  <td className="dev-note-inline">{GUARDRAIL_RAIL_WHAT_IT_CHECKS[rail.name] ?? "-"}</td>
                  <td className="dev-note-inline">{rail.decisions.join(" -> ") || "-"}</td>
                  <td className="dev-note-inline">{rail.stop ? "Failed" : "Passed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

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

// Phase 222 - one real, verified sentence per prompt constant (read
// directly from ai/prompts/agent_prompts.py and
// ai/rag_pipeline/response_generation/response_generator.py, not
// summarized from memory) - what that constant actually instructs the
// model to do, shown alongside the real prompt text itself below.
const PROMPT_CONSTANT_ROLES: Record<string, string> = {
  PLANNER_SYSTEM_PROMPT:
    "Breaks the question into one or more tasks, each assigned to a named domain agent (vector_kb_agent/lms_ops_agent/sql_db_agent/lms_analytics_agent/web_search_agent) - decides WHO should handle WHAT, not the answer itself.",
  REVIEWER_SYSTEM_PROMPT:
    "Merges every domain agent's raw result into one direct answer to the original question, deduplicating anything more than one agent covered.",
  ORCHESTRATION_SYSTEM_PROMPT:
    "Instructs the model to use its bound tools (SearchKnowledgeBase/GetLeaveBalance/GetLeaveHistory) rather than guess, then write the final answer in its own words - never paste a tool's raw output back verbatim.",
  "RAG_PROMPT (or CONVERSATIONAL_FALLBACK_PROMPT if no chunks were retrieved)":
    "A few-shot prompt with 2 worked examples baked in (direct fact lookup, eligibility/rule-based answer) - answer ONLY from the retrieved context, cite the source document by name after each fact, say \"I don't know\" rather than guess. Falls back to CONVERSATIONAL_FALLBACK_PROMPT (answer from prior conversation turns only) when retrieval found nothing this time.",
};

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
  // Phase 3/4 - 2-level tab tree (top -> leaf), replacing the old flat
  // 10-tab row. Defaults land on the same effective view as before this
  // phase (Metrics), just one level deeper.
  const [activeTopTab, setActiveTopTab] = useState<ExplainTopTab>("responseGeneration");
  const [activeRetrievalLeaf, setActiveRetrievalLeaf] = useState<ExplainRetrievalLeaf>("kbRetrieval");
  const [activeResponseLeaf, setActiveResponseLeaf] = useState<ExplainResponseLeaf>("metrics");
  const showingRetrieval = activeTopTab === "retrieval";
  const showingResponseGeneration = activeTopTab === "responseGeneration";
  const [activeTestingStrategyLeaf, setActiveTestingStrategyLeaf] =
    useState<ExplainTestingStrategyLeaf>("goldenDataset");
  const [activePlatformArchitectureLeaf, setActivePlatformArchitectureLeaf] =
    useState<ExplainPlatformArchitectureLeaf>("ragIngestion");
  const showingTestingStrategy = activeTopTab === "testingStrategy";
  const showingPlatformArchitecture = activeTopTab === "platformArchitecture";
  // Phase 229 round 2 - user-requested: Input/Output Check split into
  // their own sub-tabs instead of always shown side by side, so each
  // one's now-4-column validations table gets the full tab width
  // instead of half of it.
  const [guardrailsSubTab, setGuardrailsSubTab] = useState<GuardrailGateId>("gate1");
  const [optimizationSubTab, setOptimizationSubTab] = useState<"caching">("caching");

  // Phase 216 - chunking strategy is a per-document, ingestion-time setting
  // (not captured anywhere in a query response), so it's fetched here from
  // the existing GET .../documents/{id} endpoint instead of adding a new
  // metadata-store lookup to the query pipeline. That endpoint is
  // HR_SUPPORT/ADMIN/EMPLOYEE_ADMIN-only (api/rag/ingest_document.py), so
  // it's only attempted for those roles - an employee/manager would just
  // get a 403, not useful data.
  const [chunkingStrategies, setChunkingStrategies] = useState<Record<string, string>>({});
  const [chunkingFetchStarted, setChunkingFetchStarted] = useState(false);

  useEffect(() => {
    if (!showingRetrieval || activeRetrievalLeaf !== "kbRetrieval" || chunkingFetchStarted) {
      return;
    }
    if (!identity || !PRIVILEGED_DOCUMENT_ROLES.has(identity.role)) {
      return;
    }
    const uniqueDocumentIds = Array.from(new Set((message.sources ?? []).map((source) => source.document_id)));
    if (uniqueDocumentIds.length === 0) {
      return;
    }
    setChunkingFetchStarted(true);
    Promise.all(
      uniqueDocumentIds.map(async (documentId) => {
        try {
          const document = await getDocument(identity, documentId);
          return [documentId, document.chunk_info?.chunking_strategy ?? "n/a"] as const;
        } catch {
          return [documentId, "unavailable"] as const;
        }
      }),
    ).then((results) => setChunkingStrategies(Object.fromEntries(results)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingRetrieval, activeRetrievalLeaf, identity, message.id, chunkingFetchStarted]);

  if (message.adhoc) {
    return <AdhocExplainability {...props} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability</h2>

        <div style={{ marginBottom: 20 }}>
          <div className="tab-strip">
            {EXPLAIN_TOP_ORDER.map((top) => (
              <button
                key={top}
                type="button"
                className={activeTopTab === top ? "tab-strip-button-active" : "tab-strip-button"}
                onClick={() => setActiveTopTab(top)}
              >
                {EXPLAIN_TOP_LABELS[top]}
              </button>
            ))}
          </div>

          {showingRetrieval && (
            <div className="tab-strip tab-strip-nested">
              {EXPLAIN_RETRIEVAL_LEAF_ORDER.map((leaf) => (
                <button
                  key={leaf}
                  type="button"
                  className={activeRetrievalLeaf === leaf ? "tab-strip-button-active" : "tab-strip-button"}
                  onClick={() => setActiveRetrievalLeaf(leaf)}
                >
                  {EXPLAIN_RETRIEVAL_LEAF_LABELS[leaf]}
                </button>
              ))}
            </div>
          )}

          {showingResponseGeneration && (
            <div className="tab-strip tab-strip-nested">
              {EXPLAIN_RESPONSE_LEAF_ORDER.map((leaf) => (
                <button
                  key={leaf}
                  type="button"
                  className={activeResponseLeaf === leaf ? "tab-strip-button-active" : "tab-strip-button"}
                  onClick={() => setActiveResponseLeaf(leaf)}
                >
                  {EXPLAIN_RESPONSE_LEAF_LABELS[leaf]}
                </button>
              ))}
            </div>
          )}

          {showingTestingStrategy && (
            <div className="tab-strip tab-strip-nested">
              {EXPLAIN_TESTING_STRATEGY_LEAF_ORDER.map((leaf) => (
                <button
                  key={leaf}
                  type="button"
                  className={activeTestingStrategyLeaf === leaf ? "tab-strip-button-active" : "tab-strip-button"}
                  onClick={() => setActiveTestingStrategyLeaf(leaf)}
                >
                  {EXPLAIN_TESTING_STRATEGY_LEAF_LABELS[leaf]}
                </button>
              ))}
            </div>
          )}

          {showingPlatformArchitecture && (
            <div className="tab-strip tab-strip-nested">
              {EXPLAIN_PLATFORM_ARCHITECTURE_LEAF_ORDER.map((leaf) => (
                <button
                  key={leaf}
                  type="button"
                  className={activePlatformArchitectureLeaf === leaf ? "tab-strip-button-active" : "tab-strip-button"}
                  onClick={() => setActivePlatformArchitectureLeaf(leaf)}
                >
                  {EXPLAIN_PLATFORM_ARCHITECTURE_LEAF_LABELS[leaf]}
                </button>
              ))}
            </div>
          )}
        </div>

        {showingResponseGeneration && activeResponseLeaf === "metrics" && (
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
                <p>Not tracked for this pipeline mode yet (Reflex RAG only so far - see RAG-ROADMAP.md Phase 107).</p>
              </div>
            )}
          </div>
          </div>
        )}

        {showingRetrieval && activeRetrievalLeaf === "kbRetrieval" && (() => {
          const mode = detectPipelineMode(message);
          const searchToolCall = toolCallByName(message, "SearchKnowledgeBase");
          // Phase 216 - 3 real answers, not one: genai-rag's own per-request
          // choice, multi-agentic-rag's always-similarity KB Vector Agent
          // (confirmed by reading vector_kb_agent.py - it never passes a
          // strategy arg), single-agentic-rag's agent-chosen one (now
          // captured in ToolCallInfo.search_strategy - was silently dropped
          // before this phase).
          const resolvedSearchStrategy = message.retrievalInfo
            ? message.retrievalInfo.search_strategy
            : mode === "multi-agentic-rag"
              ? "similarity"
              : searchToolCall
                ? searchToolCall.search_strategy ?? "similarity"
                : null;
          const strategyNote = message.retrievalInfo
            ? "Set from Settings' RAG Search tab for this query."
            : mode === "multi-agentic-rag"
              ? "Fixed - multi-agentic-rag's KB Vector Agent always searches by similarity; no agent-selectable strategy today."
              : "Chosen by the agent itself per tool call (it can pick 'mmr' instead of the default 'similarity') - this is what it picked for this answer.";

          return (
            <div className="explainability-tab-panel">
              {resolvedSearchStrategy ? (
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Retrieval Strategy{" "}
                    <InfoIcon info={{ label: "Retrieval strategy", description: strategyNote, implemented: true }} />
                  </span>
                  <table className="explainability-data-table">
                    <tbody>
                      {message.resolvedMode && (
                        <tr>
                          <th>
                            Auto resolved to{" "}
                            <InfoIcon
                              info={{
                                label: "Auto mode routing",
                                description:
                                  "This turn used \"Auto\" mode - a cheap classification step picked this pipeline per question instead of you selecting it directly.",
                                implemented: true,
                              }}
                            />
                          </th>
                          <td>{message.resolvedMode === "multi-agentic-rag" ? "Agentic Workflow" : "Reflex Agent"}</td>
                        </tr>
                      )}
                      <tr>
                        <th>Search strategy</th>
                        <td>{SEARCH_STRATEGY_DISPLAY_LABELS[resolvedSearchStrategy] ?? resolvedSearchStrategy}</td>
                      </tr>
                      {message.retrievalInfo && (
                        <tr>
                          <th>Vector DB</th>
                          <td>{message.retrievalInfo.vector_db}</td>
                        </tr>
                      )}
                      {message.retrievalInfo?.applied_filter && (
                        <tr>
                          <th>Self-Query filter</th>
                          <td><pre className="llm-context-pre">{JSON.stringify(message.retrievalInfo.applied_filter, null, 2)}</pre></td>
                        </tr>
                      )}
                      {!!message.retrievalInfo?.acl_denied_count && (
                        <tr>
                          <th>
                            Access control{" "}
                            <InfoIcon
                              info={{
                                label: "Document ACL",
                                description:
                                  "Documents can be restricted to specific roles or departments at upload time. " +
                                  "This counts how many were excluded from this answer's search because this " +
                                  "caller's role/department didn't qualify - not which documents, since showing " +
                                  "that would itself reveal what's being hidden.",
                                implemented: true,
                              }}
                            />
                          </th>
                          <td>
                            {message.retrievalInfo.acl_denied_count} document
                            {message.retrievalInfo.acl_denied_count === 1 ? "" : "s"} excluded by access-control rules
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="panel panel-warning">
                  <p>
                    No knowledge-base retrieval happened for this answer (routed to the Leave Management System or
                    web search instead, or answered from conversation memory alone) - nothing to show here.
                  </p>
                </div>
              )}

              {resolvedSearchStrategy === "hybrid" && (() => {
                const taggedSources = sources.filter((source) => source.matched_by && source.matched_by.length > 0);
                const sparseOnly = taggedSources.filter((source) => source.matched_by!.length === 1 && source.matched_by![0] === "sparse").length;
                const denseOnly = taggedSources.filter((source) => source.matched_by!.length === 1 && source.matched_by![0] === "dense").length;
                const both = taggedSources.filter((source) => source.matched_by!.length === 2).length;
                return (
                  <div className="panel panel-info">
                    <span className="panel-eyebrow">
                      Dense/Sparse Contribution{" "}
                      <InfoIcon
                        info={{
                          label: "Hybrid search: no tunable weight",
                          description: (
                            <>
                              <HelpSection heading="How results are combined">
                                Pure Reciprocal Rank Fusion (RRF): score = sum(1 / (60 + rank)) across every list a
                                chunk appears in.
                              </HelpSection>
                              <HelpSection heading="Why there's no weight to show">
                                There is no dense/sparse weight or alpha blend anywhere in it - both lists contribute
                                identically by rank position, by design (RRF's own point is being scale-free, since
                                BM25's unbounded score and cosine similarity's 0-1 range can't be compared directly
                                without normalizing one against the other).
                              </HelpSection>
                              <HelpSection heading="What's shown instead">
                                Which list(s) actually found each of this answer's chunks, in the table below.
                              </HelpSection>
                            </>
                          ),
                          implemented: true,
                        }}
                      />
                    </span>
                    {taggedSources.length > 0 ? (
                      <>
                        <table className="explainability-data-table">
                          <tbody>
                            <tr>
                              <th>Sparse only (BM25 keyword)</th>
                              <td className="eval-score-value">{sparseOnly}</td>
                            </tr>
                            <tr>
                              <th>Dense only (vector similarity)</th>
                              <td className="eval-score-value">{denseOnly}</td>
                            </tr>
                            <tr>
                              <th>Both</th>
                              <td className="eval-score-value">{both}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="eval-score-caption">
                          Of {taggedSources.length} chunk(s) in this answer. A chunk sparse found but dense missed (or
                          vice versa) is a real signal: if that happens often, hybrid is earning its extra search cost
                          over similarity alone - if "both" dominates every time, the two sides are mostly agreeing
                          and keyword search may not be adding much for this kind of question.
                        </p>
                      </>
                    ) : (
                      <p className="eval-score-caption">Not available for this answer (served from cache, most likely).</p>
                    )}
                  </div>
                );
              })()}

              {sources.length > 0 && (
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Chunking Strategy by Source Document{" "}
                    <InfoIcon
                      info={{
                        label: "Chunking strategy",
                        description:
                          "Chosen per document at upload time (Document upload's own Chunking Strategy field), not " +
                          "per query - today's query pipeline doesn't track it per chunk, so this is fetched live " +
                          "from each source's own document record instead.",
                        implemented: true,
                      }}
                    />
                  </span>
                  {identity && PRIVILEGED_DOCUMENT_ROLES.has(identity.role) ? (
                    <table className="explainability-data-table">
                      <tbody>
                        {Array.from(new Set(sources.map((source) => source.document_id))).map((documentId) => {
                          const filename = sources.find((source) => source.document_id === documentId)?.filename ?? documentId;
                          return (
                            <tr key={documentId}>
                              <th>{filename}</th>
                              <td>{chunkingStrategies[documentId] ?? "Loading..."}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="dev-note-inline">
                      Visible to HR/Admin roles only (same access as Document Management) - not shown for your role.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {showingResponseGeneration && activeResponseLeaf === "agentRouting" && (
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
                        <td>
                          {task.focus}
                          <span className="agent-flow-reasoning">Why: {task.reasoning}</span>
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
                Not applicable for this pipeline mode - Reflex RAG is a single retrieve-then-generate call with no
                agent loop at all. See the Knowledge Sources panel on the Metrics tab instead.
              </p>
            </div>
          )}
          </div>
        )}

        {showingRetrieval && activeRetrievalLeaf === "retrievalScore" && (
          <div className="explainability-tab-panel">
          {/* Phase 3 - Retrieval Score / Evals Score, previously one merged
              "Eval Score" tab with an internal pill switch (2026-10-19),
              now two independent leaf tabs (Retrieval > Retrieval Score,
              Response Generation > Evals Score) reached via the main
              3-level tab tree - a content-faithful split, not new content. */}
          <p className="dev-note-inline">
            These scores come from asking another AI to check the retrieval quality against a fixed set of 25
            test questions with known-correct answers. Hover a metric's <strong>?</strong> to see what it measures,
            why a low number isn't always a problem, and what Settings to adjust to improve it.
          </p>
          <div className="panel panel-info">
            <span className="panel-eyebrow">Live Precision/Recall/F1 for this answer</span>
            {message.explainability?.eval_scores?.retrieval_precision !== null &&
            message.explainability?.eval_scores?.retrieval_precision !== undefined ? (
              <>
                <table className="explainability-data-table">
                  <tbody>
                    <tr>
                      <th>Precision <RetrievalMetricIcon metric="precision" label="Precision (live)" /></th>
                      <td className="eval-score-value">{message.explainability.eval_scores.retrieval_precision.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <th>Recall (estimate) <RetrievalMetricIcon metric="recall" label="Recall (live, estimated)" /></th>
                      <td className="eval-score-value">
                        {message.explainability.eval_scores.retrieval_recall_estimate !== null
                          ? message.explainability.eval_scores.retrieval_recall_estimate.toFixed(2)
                          : "n/a"}
                      </td>
                    </tr>
                    <tr>
                      <th>F1 (estimate) <RetrievalMetricIcon metric="f1" label="F1 (live, estimated)" /></th>
                      <td className="eval-score-value">
                        {message.explainability.eval_scores.retrieval_f1_estimate !== null
                          ? message.explainability.eval_scores.retrieval_f1_estimate.toFixed(2)
                          : "n/a"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="eval-score-caption">
                  Chunk(s) {message.explainability.eval_scores.retrieval_relevant_chunk_indices.join(", ") || "none"} judged relevant
                </p>
                {/* Phase 226 - only shown when it actually happened, not as a
                    "false" line on every answer that never had the feature
                    on in the first place. */}
                {message.explainability.eval_scores.retrieval_retry_attempted && (
                  <p className="eval-score-caption">
                    Retried: the first search looked weak, so the system searched again with more candidates
                    before generating this answer - the numbers above are from that second, retried search.
                  </p>
                )}
                {/* Phase 225 - the real arithmetic behind the 3 numbers above,
                    not just the final ratios - every value here is already
                    in the response, just not shown as the calculation that
                    produced it. */}
                <div className="eval-score-group">
                  <span className="eval-score-group-label">Calculation</span>
                  <ul className="citation-list">
                    <li>
                      Precision = {message.explainability.eval_scores.retrieval_relevant_chunk_indices.length} relevant
                      / {sources.length} retrieved = {message.explainability.eval_scores.retrieval_precision.toFixed(2)}
                    </li>
                    {message.explainability.eval_scores.retrieval_recall_estimate !== null &&
                    message.explainability.eval_scores.retrieval_recall_relevant_count !== null ? (
                      <li>
                        Recall = {message.explainability.eval_scores.retrieval_relevant_chunk_indices.length} relevant
                        (within the {sources.length} retrieved) /{" "}
                        {message.explainability.eval_scores.retrieval_recall_relevant_count} relevant found anywhere in
                        the {message.explainability.eval_scores.retrieval_recall_pool_size}-chunk pool ={" "}
                        {message.explainability.eval_scores.retrieval_recall_estimate.toFixed(2)}
                      </li>
                    ) : (
                      <li>Recall = n/a (nothing in the candidate pool was judged relevant, so there's no count to divide by)</li>
                    )}
                    {message.explainability.eval_scores.retrieval_f1_estimate !== null && (
                      <li>
                        F1 = 2 × ({message.explainability.eval_scores.retrieval_precision.toFixed(2)} ×{" "}
                        {message.explainability.eval_scores.retrieval_recall_estimate?.toFixed(2)}) / (
                        {message.explainability.eval_scores.retrieval_precision.toFixed(2)} +{" "}
                        {message.explainability.eval_scores.retrieval_recall_estimate?.toFixed(2)}) ={" "}
                        {message.explainability.eval_scores.retrieval_f1_estimate.toFixed(2)}
                      </li>
                    )}
                  </ul>
                </div>
                {message.explainability.eval_scores.retrieval_recall_estimate !== null ? (
                  <p className="eval-score-caption">
                    Recall/F1 are estimated by checking a wider set of {message.explainability.eval_scores.retrieval_recall_pool_size} candidate
                    chunks (the ones retrieved, plus some extra nearby ones) - hover <strong>?</strong> above for more detail.
                  </p>
                ) : (
                  <p className="eval-score-caption">
                    Recall/F1 show "n/a" here: out of the {message.explainability.eval_scores.retrieval_recall_pool_size ?? "?"}
                    {" "}candidate chunks checked, none were found relevant - not even the one(s) retrieved for this answer -
                    so there's nothing to calculate a ratio from. Hover <strong>?</strong> above for more detail.
                  </p>
                )}
                {message.explainability.eval_scores.retrieval_precision_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.retrieval_precision_explanation}</pre>
                )}
              </>
            ) : (
              <p className="eval-score-caption">Not available (no retrieved context, or served from cache).</p>
            )}
          </div>
          <BelowThresholdRecommendations
            belowThresholdMetrics={(message.explainability?.eval_scores?.below_threshold_metrics ?? []).filter(
              (metric) => metric === "retrieval_precision",
            )}
            threshold={message.evalScoreThreshold}
            guidance={{ retrieval_precision: RETRIEVAL_METRIC_GUIDANCE.precision }}
            message={message}
          />
          <div className="panel panel-info">
            <span className="panel-eyebrow">Golden dataset reference (offline, 25 cases, 2026-10-17)</span>
            <table className="explainability-data-table">
              <tbody>
                <tr>
                  <th>Precision@5 <RetrievalMetricIcon metric="precision" label="Precision (offline)" /></th>
                  <td className="eval-score-value">0.200</td>
                </tr>
                <tr>
                  <th>Recall@5 <RetrievalMetricIcon metric="recall" label="Recall (offline)" /></th>
                  <td className="eval-score-value">1.000</td>
                </tr>
                <tr>
                  <th>F1 <RetrievalMetricIcon metric="f1" label="F1 (offline)" /></th>
                  <td className="eval-score-value">0.333</td>
                </tr>
              </tbody>
            </table>
            <p className="eval-score-caption">
              Precision is always low here by design (this test only counts 1 correct document per question) -
              Recall is the number that actually has to pass (minimum 0.6) before a release is allowed.
            </p>
          </div>
          </div>
        )}

        {showingResponseGeneration && activeResponseLeaf === "evalsScore" && (
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
              <span className="panel-eyebrow">Evals Score</span>

              <div className="eval-score-group">
                <span className="eval-score-group-label">
                  Groundedness <ResponseMetricIcon metric="groundedness" label="Groundedness" />
                </span>
                <p className="eval-score-value">
                  {message.explainability.eval_scores.groundedness.toFixed(2)} - {message.explainability.eval_scores.groundedness_verdict}
                </p>
                <p className="eval-score-caption">Does the answer actually come from the retrieved documents, or did it make something up?</p>
                {parseJudgeRawScore(message.explainability.eval_scores.groundedness_explanation) && (
                  <p className="eval-score-caption">
                    How: the AI judge gave a raw score of {parseJudgeRawScore(message.explainability.eval_scores.groundedness_explanation)}
                  </p>
                )}
                {message.explainability.eval_scores.groundedness_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.groundedness_explanation}</pre>
                )}
              </div>

              <div className="eval-score-group">
                <span className="eval-score-group-label">
                  Completeness <ResponseMetricIcon metric="completeness" label="Completeness" />
                </span>
                <p className="eval-score-value">
                  {message.explainability.eval_scores.completeness.toFixed(2)} - {message.explainability.eval_scores.completeness_verdict}
                </p>
                <p className="eval-score-caption">Does the answer fully cover what was actually asked?</p>
                {parseJudgeRawScore(message.explainability.eval_scores.completeness_explanation) && (
                  <p className="eval-score-caption">
                    How: the AI judge gave a raw score of {parseJudgeRawScore(message.explainability.eval_scores.completeness_explanation)}
                  </p>
                )}
                {message.explainability.eval_scores.completeness_explanation && (
                  <pre className="llm-context-pre">{message.explainability.eval_scores.completeness_explanation}</pre>
                )}
              </div>

              <div className="eval-score-group">
                <span className="eval-score-group-label">How this was calculated</span>
                <ul className="citation-list">
                  <li>
                    Another AI acts as a "judge": it's shown the question, the answer, and the documents used, and
                    asked to score each one from 0-10. That raw score (shown above each metric) is then divided by
                    10 to get the 0.00-1.00 number shown - its full written reasoning is shown below each score.
                  </li>
                  <li>
                    This is a custom judge built for this project, not an off-the-shelf library
                    {message.explainability.latency_ms.eval !== null && ` - took ${message.explainability.latency_ms.eval.toFixed(0)}ms`}.
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="panel panel-warning">
              <span className="panel-eyebrow">Evals Score</span>
              <p>Not available for this message (no retrieved context to check groundedness against).</p>
            </div>
          )}
          {message.explainability?.eval_scores && (
            <BelowThresholdRecommendations
              belowThresholdMetrics={(message.explainability.eval_scores.below_threshold_metrics ?? []).filter(
                (metric) => metric === "groundedness" || metric === "completeness",
              )}
              threshold={message.evalScoreThreshold}
              guidance={RESPONSE_METRIC_GUIDANCE}
              message={message}
            />
          )}
          </div>
        )}

        {showingResponseGeneration && activeResponseLeaf === "guardrails" && (() => {
          const mode = detectPipelineMode(message);
          const searchStrategy =
            message.retrievalInfo?.search_strategy ??
            (mode === "multi-agentic-rag" ? "similarity" : toolCallByName(message, "SearchKnowledgeBase")?.search_strategy ?? null);
          const selfQueryFilter = message.retrievalInfo?.applied_filter ?? null;
          const evalScores = message.explainability?.eval_scores ?? null;

          return (
            <div className="explainability-tab-panel">
              {/* 2026-10-19 round 2 - user-requested: expanded from NeMo-only
                  (2 of the 6 gates) to all 6, after the narrower scope kept
                  reading as "only 2 checks exist" rather than "only 2 are
                  NeMo's". Gates 2/3/5 point at their own dedicated tab for
                  full detail instead of duplicating it here. */}
              <p className="dev-note-inline">
                Real, per-answer status for each of this project's 6 validation gates - not a static list of what
                exists.{" "}
                <HelpPopover label="How to read this tab">
                  <p>
                    If a question gets fully blocked at Gate 1 or Gate 6 (it looks like an attempt to misuse the
                    system), it never reaches this screen at all - the request stops right there with an error
                    instead of an answer. That's why those two checks can only ever show "Pass" or "Modified" here,
                    never "Blocked".
                  </p>
                  <p>
                    Gates 2, 3, and 5 are built differently than Gates 1/6 (no NeMo Guardrails rail/activation log to
                    show) - this tab gives each a real, honest status line, and points to its own tab (KB Retrieval,
                    Retrieval Score/Evals Score) for the full detail already shown there, rather than repeating it.
                  </p>
                </HelpPopover>
              </p>
              <div className="tab-strip" style={{ marginTop: 4, marginBottom: 12 }}>
                {GUARDRAIL_GATES.map((gate) => (
                  <button
                    key={gate.id}
                    type="button"
                    className={guardrailsSubTab === gate.id ? "tab-strip-button-active" : "tab-strip-button"}
                    onClick={() => setGuardrailsSubTab(gate.id)}
                  >
                    {gate.label}
                  </button>
                ))}
              </div>

              {guardrailsSubTab === "gate1" &&
                (message.explainability?.guardrails ? (
                  <>
                    <div className="panel panel-success" style={{ marginBottom: 12 }}>
                      <span className="panel-eyebrow">
                        Gate 1 - Input Firewall{" "}
                        <InfoIcon
                          info={{
                            label: "Input Firewall",
                            description:
                              "The first stage every request passes through: is the request itself well-formed " +
                              "(schema validation - field types, lengths, required fields), and does the question " +
                              "look safe to act on (NeMo Guardrails' input check, below) before any retrieval or " +
                              "generation ever starts.",
                            implemented: true,
                          }}
                        />
                      </span>
                      <p className="eval-score-caption">
                        Schema validation: Passed - a malformed request never reaches this screen at all (it's
                        rejected before an answer is ever generated).
                      </p>
                    </div>
                    <GuardrailCheckPanel title="Input Check (NeMo Guardrails)" check={message.explainability.guardrails.input} />
                  </>
                ) : (
                  <div className="panel panel-warning">
                    <span className="panel-eyebrow">Gate 1 - Input Firewall</span>
                    <p>Not available for this message.</p>
                  </div>
                ))}

              {guardrailsSubTab === "gate2" && (
                <div className="panel panel-success">
                  <span className="panel-eyebrow">
                    Gate 2 - Access Control{" "}
                    <InfoIcon
                      info={{
                        label: "Access control",
                        description:
                          "Three separate checks, each a plain pass/fail with no NeMo-style activation log: " +
                          "which roles may call this endpoint at all, which specific documents a role/department " +
                          "may see (Phase 231), and how many requests a caller can make per minute.",
                        implemented: true,
                      }}
                    />
                  </span>
                  <table className="explainability-data-table">
                    <tbody>
                      <tr>
                        <th>Role check</th>
                        <td>
                          Passed{identity ? ` - role "${identity.role}" is permitted for this endpoint` : ""} (a role
                          not on the allowed list never reaches this screen at all).
                        </td>
                      </tr>
                      <tr>
                        <th>
                          Document ACL{" "}
                          <InfoIcon
                            info={{
                              label: "Document ACL",
                              description:
                                "Documents can be restricted to specific roles or departments at upload time " +
                                "(Phase 231). This counts how many were excluded from this answer's search - not " +
                                "which documents, since showing that would itself reveal what's being hidden.",
                              implemented: true,
                            }}
                          />
                        </th>
                        <td>
                          {mode === "genai-rag" && message.retrievalInfo ? (
                            message.retrievalInfo.acl_denied_count > 0 ? (
                              `${message.retrievalInfo.acl_denied_count} document${message.retrievalInfo.acl_denied_count === 1 ? "" : "s"} excluded by access-control rules for this answer.`
                            ) : (
                              "No documents excluded - nothing restricted matched this request."
                            )
                          ) : (
                            "Not shown for this pipeline yet - genai-rag only today (see RAG-ROADMAP.md Phase 232)."
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>Rate limiting</th>
                        <td>
                          Passed (implicit - a rate-limited request never reaches this screen at all; no per-request
                          usage count is returned in this response today).
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {guardrailsSubTab === "gate3" && (
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Gate 3 - Retrieval Strategy{" "}
                    <InfoIcon
                      info={{
                        label: "Retrieval Strategy",
                        description:
                          "How the question actually got turned into a document search: which search algorithm " +
                          "ran (similarity/MMR/hybrid/etc.), and whether Self-Query parsed a metadata filter " +
                          "(e.g. 'only policy documents') out of the question's own wording before searching.",
                        implemented: true,
                      }}
                    />
                  </span>
                  <table className="explainability-data-table">
                    <tbody>
                      <tr>
                        <th>Search strategy</th>
                        <td>
                          {searchStrategy
                            ? SEARCH_STRATEGY_DISPLAY_LABELS[searchStrategy] ?? searchStrategy
                            : "No knowledge-base retrieval happened for this answer."}
                        </td>
                      </tr>
                      {selfQueryFilter && (
                        <tr>
                          <th>Self-Query filter</th>
                          <td>
                            <pre className="llm-context-pre">{JSON.stringify(selfQueryFilter, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="eval-score-caption">
                    Full detail (vector DB, dense/sparse contribution for hybrid search) is in the Retrieval Strategy
                    tab.
                  </p>
                </div>
              )}

              {guardrailsSubTab === "gate4" &&
                (() => {
                  // 2026-10-19 round 3 - corrected: this was wrongly shown as
                  // "not built" - Phase 226's corrective retry IS this gate's
                  // real implementation (its own spec literally calls it "the
                  // standard Corrective RAG (CRAG) shape"), just opt-in and
                  // genai-rag only, which is why it read as missing before.
                  const retryArmed = mode === "genai-rag" && message.enableCorrectiveRetry === true;
                  const retryFired = evalScores?.retrieval_retry_attempted === true;
                  return (
                    <div className={retryFired ? "panel panel-success" : "panel panel-info"}>
                      <span className="panel-eyebrow">
                        Gate 4 - Context Grade{" "}
                        <InfoIcon
                          info={{
                            label: "Context Grade",
                            description:
                              "Real, built as Phase 226's corrective retry - its own spec calls it \"the standard " +
                              "Corrective RAG (CRAG) shape\", just narrower than a full per-chunk relevance grader: " +
                              "it checks the RETRIEVED CHUNKS' own live precision once, and if it's below your Eval " +
                              "Score Threshold, retries retrieval once with a wider candidate pool (doubled top_k, " +
                              "capped at 20) before any answer is generated. Opt-in (Settings' RAG Config tab), " +
                              "genai-rag only today.",
                            implemented: true,
                          }}
                        />
                      </span>
                      {mode !== "genai-rag" ? (
                        <p className="eval-score-caption">
                          Not available for this pipeline today - the corrective retry below only exists in
                          genai-rag.
                        </p>
                      ) : !retryArmed ? (
                        <p className="eval-score-caption">
                          Off for this request - no corrective retry ran. Turn on "Retry Once on Low Retrieval
                          Score" in Settings' RAG Config tab to arm it (also needs an Eval Score Threshold set).
                        </p>
                      ) : retryFired ? (
                        <p className="eval-score-caption">
                          Fired for this answer - the first retrieval's precision was below your threshold
                          {message.evalScoreThreshold !== undefined ? ` (${message.evalScoreThreshold})` : ""}, so
                          retrieval ran a second time with a wider candidate pool before the answer was generated.
                        </p>
                      ) : (
                        <p className="eval-score-caption">
                          Armed{message.evalScoreThreshold !== undefined ? ` (threshold ${message.evalScoreThreshold})` : ""}
                          {" "}but didn't need to fire - the first retrieval's precision already met the bar.
                        </p>
                      )}
                    </div>
                  );
                })()}

              {guardrailsSubTab === "gate5" &&
                (evalScores ? (
                  <div className={evalScores.groundedness_verdict === "GROUNDED" ? "panel panel-success" : "panel panel-warning"}>
                    <span className="panel-eyebrow">
                      Gate 5 - Grounding{" "}
                      <InfoIcon
                        info={{
                          label: "Grounding",
                          description:
                            "DeepEval's FaithfulnessMetric is this project's real Gate 5 tool, but it only runs " +
                            "offline against the golden dataset (see the Eval Score tab's Retrieval Score sub-tab " +
                            "for that). This live, per-answer number comes from a different, custom-built judge " +
                            "that checks the same thing (is the answer actually grounded in what was retrieved) " +
                            "for every real question, not just test-dataset ones.",
                          implemented: true,
                        }}
                      />
                    </span>
                    <p className="eval-score-value">
                      {evalScores.groundedness.toFixed(2)} - {evalScores.groundedness_verdict}
                    </p>
                    <p className="eval-score-caption">
                      Does the answer actually come from the retrieved documents, or did it make something up? Full
                      detail (the judge's full reasoning) is in the Eval Score tab.
                    </p>
                  </div>
                ) : (
                  <div className="panel panel-warning">
                    <span className="panel-eyebrow">Gate 5 - Grounding</span>
                    <p>Not available for this message (no retrieved context to check groundedness against).</p>
                  </div>
                ))}

              {guardrailsSubTab === "gate6" &&
                (message.explainability?.guardrails ? (
                  <>
                    <GuardrailCheckPanel
                      title="Output Check (NeMo Guardrails)"
                      check={message.explainability.guardrails.output}
                      blockedNote="The original answer was swapped out for a safe, generic message before being sent to you."
                    />
                    <div className="panel panel-success" style={{ marginTop: 12 }}>
                      <span className="panel-eyebrow">
                        Gate 6 - Delivery{" "}
                        <InfoIcon
                          info={{
                            label: "Delivery",
                            description:
                              "The last stage: NeMo Guardrails' output check (above) runs on the generated answer " +
                              "before it's sent back, then the response is built into its final shape and returned " +
                              "- or, on an unexpected error anywhere in the pipeline, a consistent error shape is " +
                              "returned instead of a raw crash.",
                            implemented: true,
                          }}
                        />
                      </span>
                      <p className="eval-score-caption">Passed - a response was successfully built and returned.</p>
                    </div>
                  </>
                ) : (
                  <div className="panel panel-warning">
                    <span className="panel-eyebrow">Gate 6 - Delivery</span>
                    <p>Not available for this message.</p>
                  </div>
                ))}
            </div>
          );
        })()}

        {activeTopTab === "cacheOptimization" && (
          <div className="explainability-tab-panel">
            <div className="tab-strip" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={optimizationSubTab === "caching" ? "tab-strip-button-active" : "tab-strip-button"}
                onClick={() => setOptimizationSubTab("caching")}
              >
                Caching
              </button>
            </div>
            {optimizationSubTab === "caching" && (
              <>
                <p className="dev-note-inline">
                  5 real caching techniques this project actually uses, plus 3 more worth knowing that aren't built
                  here - each card says plainly which is which, not every one applies to every message.
                </p>
                <span className="eval-score-group-label" style={{ display: "block", marginTop: 4 }}>
                  Implemented in this project
                </span>
                {CACHING_TECHNIQUES.filter((technique) => technique.implemented).map((technique) => (
                  <div
                    key={technique.id}
                    className={
                      technique.id === "answerCache" && message.explainability
                        ? message.explainability.served_from_cache
                          ? "panel panel-success"
                          : "panel panel-info"
                        : "panel panel-info"
                    }
                    style={{ marginBottom: 12 }}
                  >
                    <span className="panel-eyebrow">
                      {technique.label}
                      <InfoIcon
                        info={{
                          label: `What is "${technique.label}"?`,
                          description: (
                            <>
                              <HelpSection heading="What it does">{technique.what}</HelpSection>
                              <HelpSection heading="How it works">{technique.mechanism}</HelpSection>
                              <HelpSection heading="When it applies">{technique.scope}</HelpSection>
                            </>
                          ),
                          implemented: true,
                        }}
                      />
                    </span>
                    {technique.id === "answerCache" && (
                      <p className="eval-score-caption">
                        {message.explainability
                          ? message.explainability.served_from_cache
                            ? "This answer: served from cache."
                            : "This answer: not from cache (live retrieval + generation)."
                          : "This answer: cache status not available."}
                      </p>
                    )}
                    {technique.id !== "answerCache" && <p className="eval-score-caption">{technique.scope}</p>}
                  </div>
                ))}

                <span className="eval-score-group-label" style={{ display: "block", marginTop: 16 }}>
                  Not implemented here - worth knowing for interview purposes
                </span>
                {CACHING_TECHNIQUES.filter((technique) => !technique.implemented).map((technique) => (
                  <div key={technique.id} className="panel panel-warning" style={{ marginBottom: 12 }}>
                    <span className="panel-eyebrow">
                      {technique.label}
                      <InfoIcon
                        info={{
                          label: `What is "${technique.label}"?`,
                          description: (
                            <>
                              <HelpSection heading="What it does">{technique.what}</HelpSection>
                              <HelpSection heading="How it works">{technique.mechanism}</HelpSection>
                              <HelpSection heading="Why it's not built here">{technique.scope}</HelpSection>
                            </>
                          ),
                          implemented: false,
                        }}
                      />
                    </span>
                    <p className="eval-score-caption">{technique.scope}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {showingResponseGeneration && activeResponseLeaf === "engineeringTrace" && (() => {
          const mode = detectPipelineMode(message);
          const turns = message.explainability?.llm_context?.turns ?? [];
          const sources = message.sources ?? [];
          const distinctDocuments = Array.from(new Set(sources.map((source) => source.filename)));
          const iterationCount = turns.filter((turn) => turn.label.startsWith("iteration ")).length;
          // genai-rag labels a decomposed sub-question turn with the sub-
          // question's own text (pipeline.py: turn["label"] = sub_question
          // when len(sub_results) > 1) - real data, not synthesized here.
          const subQuestionTurns = mode === "genai-rag" ? turns.filter((turn) => !turn.label.startsWith("Merging")) : [];

          // 2026-10-19 - sources[0].text is the raw ingested chunk (PDF
          // bullet lists keep their own blank lines between items), and
          // this preview renders inside a <pre> (preserves whitespace
          // verbatim) - slicing the raw text could land right after one of
          // those blank lines, showing dangling empty space before the
          // truncation "..." (reported live, with a screenshot). Collapsing
          // all whitespace runs to a single space first keeps this a clean
          // one-line preview regardless of the source document's own
          // formatting.
          const previewText = (text: string, limit: number) => {
            const collapsed = text.replace(/\s+/g, " ").trim();
            return collapsed.length > limit ? `${collapsed.slice(0, limit)}...` : collapsed;
          };

          const contextExample =
            mode === "multi-agentic-rag"
              ? sources[0]
                ? `[vector_kb_agent] ${previewText(sources[0].text, 80)}`
                : "[agent_name] <that agent's result text>"
              : sources[0]
                ? `[${sources[0].filename}, chunk ${sources[0].chunk_index}]\n${previewText(sources[0].text, 80)}`
                : "[filename, chunk N]\n<chunk text>";

          return (
            <div className="explainability-tab-panel">
              <p className="dev-note-inline">
                A synthesis view, not a duplicate of LLM Context's raw prompt/response text - cross-references which
                real backend code produced this answer, with real examples from this specific one.
              </p>
              <div className="explainability-row">
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Prompt Engineering{" "}
                    <InfoIcon
                      info={{
                        label: "Prompt Engineering",
                        description:
                          "Which system prompt constant actually ran for each LLM call this answer made, and what " +
                          "it instructs the model to do - expand a row below to read its real, exact text as sent, " +
                          "not a paraphrase.",
                        implemented: true,
                      }}
                    />
                  </span>
                  {turns.length === 0 ? (
                    <p className="dev-note-inline">No LLM call captured for this answer.</p>
                  ) : (
                    <>
                      <table className="explainability-data-table">
                        <thead>
                          <tr>
                            <th>Turn</th>
                            <th>Prompt constant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {turns.map((turn, index) => (
                            <tr key={`${turn.label}-${index}`}>
                              <td>{turn.label}</td>
                              <td className="dev-note-inline">{promptConstantForTurn(turn.label, mode)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* 2026-10-19 - user-reported: the Role column used to
                          repeat the SAME paragraph once per turn whenever
                          consecutive turns shared one prompt constant (the
                          common case - every sub-question in a decomposed
                          query uses the identical RAG_PROMPT), which is
                          what made this table so much taller than Context
                          Engineering next to it. A role description is a
                          property of the CONSTANT, not of each turn - moved
                          out of the per-row table into this compact legend,
                          shown once per distinct constant actually used
                          (first-appearance order), not once per turn. */}
                      <ul className="citation-list">
                        {Array.from(new Set(turns.map((turn) => promptConstantForTurn(turn.label, mode)))).map(
                          (constant) => (
                            <li key={constant}>
                              <strong>{constant}:</strong> {PROMPT_CONSTANT_ROLES[constant] ?? "-"}
                            </li>
                          ),
                        )}
                      </ul>
                      {turns.map(
                        (turn, index) =>
                          turn.system_prompt && (
                            <CollapsibleSection
                              key={`prompt-text-${turn.label}-${index}`}
                              nested
                              defaultOpen={false}
                              title={`"${turn.label}" - real system prompt text as sent`}
                            >
                              <pre className="llm-context-pre">{turn.system_prompt}</pre>
                            </CollapsibleSection>
                          ),
                      )}
                    </>
                  )}
                </div>
                {/* 2026-10-19 - user-directed: Context/Loop/Harness
                    Engineering grouped into one right-hand column next to
                    Prompt Engineering, instead of 2 separate 1:1-paired
                    rows - that old shape both stretched the much-shorter
                    Context Engineering panel to match Prompt Engineering's
                    own height (flex row default-stretch), and put Loop
                    Engineering below Prompt Engineering rather than below
                    Context Engineering where a top-to-bottom reader would
                    expect it. */}
                <div className="explainability-column">
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Context Engineering{" "}
                    <InfoIcon
                      info={{
                        label: "Context Engineering",
                        description:
                          "How retrieved information gets formatted into text before it reaches the LLM - the " +
                          "literal string template, not just a chunk count.",
                        implemented: true,
                      }}
                    />
                  </span>
                  <ul className="citation-list">
                    <li>{sources.length} chunk(s) retrieved</li>
                    <li>{distinctDocuments.length} distinct source document(s){distinctDocuments.length > 0 && `: ${distinctDocuments.join(", ")}`}</li>
                    <li className="dev-note-inline">
                      Assembled by {mode === "multi-agentic-rag" ? "build_context_from_agent_results()" : "build_context_from_chunks()"} -
                      one block per {mode === "multi-agentic-rag" ? "domain agent result" : "chunk"}, joined with a blank line between blocks.
                    </li>
                  </ul>
                  {sources.length > 0 && (
                    <>
                      <span className="eval-score-group-label">Real example (this answer's own first block)</span>
                      <pre className="llm-context-pre">{contextExample}</pre>
                    </>
                  )}
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Loop Engineering{" "}
                    <InfoIcon
                      info={{
                        label: "Loop Engineering",
                        description:
                          "Whether this pipeline mode re-prompts itself based on its own prior output (a real " +
                          "agentic loop) or runs once straight through - the IK FDE course's own reflex-vs-agentic " +
                          "distinction, made concrete against this project's actual code.",
                        implemented: true,
                      }}
                    />
                  </span>
                  {mode === "multi-agentic-rag" ? (
                    <>
                      <p className="dev-note-inline">
                        No loop - one-shot parallel fan-out, every dispatched agent runs concurrently (LangGraph's
                        Send() API), then a single Reviewer merge. No agent sees another's output or re-runs.
                      </p>
                      {message.tasks && message.tasks.length > 0 && (
                        <ul className="citation-list">
                          {message.tasks.map((task, index) => (
                            <li key={`${task.agent}-${index}`}>
                              <strong>{task.agent}</strong> - {task.focus}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : mode === "single-agentic-rag" ? (
                    <>
                      <p className="dev-note-inline">
                        Real ReAct loop - {iterationCount} iteration(s) this call (max 5 by default; hitting the max
                        returns a "wasn't able to finish reasoning" fallback answer, not a crash). Each iteration:
                        the model sees every prior tool result, decides to call another tool or write a final answer.
                      </p>
                      {message.toolsUsed && message.toolsUsed.length > 0 && (
                        <ul className="citation-list">
                          {message.toolsUsed.map((call, index) => (
                            <li key={`${call.tool_name}-${index}`}>
                              Iteration {call.iteration ?? "?"}: called <strong>{call.tool_name}</strong>
                              {call.search_strategy && ` (search_strategy=${call.search_strategy})`}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="dev-note-inline">See the Agent Flow tab for the full per-iteration prompt/response breakdown.</p>
                    </>
                  ) : (
                    <>
                      <p className="dev-note-inline">
                        No loop - a single retrieve-then-generate call per sub-question, never re-prompted with its
                        own prior output.
                        {subQuestionTurns.length > 1 && ` This question was decomposed into ${subQuestionTurns.length} sub-questions, each its own independent retrieve-then-generate call, merged by the Reviewer afterward.`}
                      </p>
                      {subQuestionTurns.length > 1 && (
                        <ul className="citation-list">
                          {subQuestionTurns.map((turn, index) => (
                            <li key={`${turn.label}-${index}`}>{turn.label}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">
                    Harness Engineering{" "}
                    <InfoIcon
                      info={{
                        label: "Harness Engineering",
                        description:
                          "The actual control-flow mechanism running this pipeline - a graph framework managing " +
                          "state/parallelism, or plain Python - and why that choice fits this mode's own shape.",
                        implemented: true,
                      }}
                    />
                  </span>
                  {mode === "multi-agentic-rag" ? (
                    <>
                      <p className="dev-note-inline">
                        LangGraph <code>StateGraph</code> - 7 real nodes (planner, 5 domain agents, reviewer), parallel
                        dispatch via LangGraph's own <code>Send()</code> API.
                      </p>
                      <p className="dev-note-inline">
                        Why a graph framework here: the Planner's own output (which agents, how many) determines the
                        fan-out shape at runtime - a plain Python loop can't express "run N things in parallel where N
                        is decided mid-execution" as cleanly as LangGraph's Send() primitive does.
                      </p>
                      <p className="dev-note-inline">ai/agents/workflow_agents/multi_agent_pipeline.py.</p>
                    </>
                  ) : mode === "single-agentic-rag" ? (
                    <>
                      <p className="dev-note-inline">
                        A plain Python <code>for</code> loop, not a graph framework - calls the LLM with bound tools
                        each iteration until it stops calling them or hits max_iterations.
                      </p>
                      <p className="dev-note-inline">
                        Why plain Python here: one agent, one sequential decision at a time (call a tool, or answer) -
                        nothing to parallelize or branch on, so a graph framework's own bookkeeping would be overhead
                        with no real benefit over a loop.
                      </p>
                      <p className="dev-note-inline">ai/agents/workflow_agents/orchestration_agent.py.</p>
                    </>
                  ) : (
                    <>
                      <p className="dev-note-inline">A single direct function call - no loop, no graph framework.</p>
                      <p className="dev-note-inline">
                        Why no framework here: genai-rag is deliberately the simplest mode (the IK FDE course's own
                        "reflex agent" shape) - retrieve once, generate once. Adding loop/graph machinery would add
                        nothing since there's no multi-step decision to manage.
                      </p>
                      <p className="dev-note-inline">ai/rag_pipeline/pipeline.py.</p>
                    </>
                  )}
                </div>
                </div>
              </div>
            </div>
          );
        })()}

        {showingResponseGeneration && activeResponseLeaf === "llmContext" && (
          <div className="explainability-tab-panel">
          {llmContext ? (
            <>
              {llmContext.turns.length === 0 && llmContext.mcp_tool_calls.length === 0 && (
                <p>Nothing captured for this answer.</p>
              )}
              {sources.length > 1 && (
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Chunk Reranking</span>
                  <p className="dev-note-inline">
                    Before generation ever sees them, retrieved chunks go through one extra LLM call that re-ranks
                    the whole batch by actual relevance to the query (most relevant first) - a single call for the
                    full set, never one per chunk. The chunk order in "Response KB source" below, and in Citations
                    on the Retrieval tab, already reflects that reranked order, not the vector store's raw
                    similarity/MMR order. If reranking fails for any reason, it fails safe and falls back to the
                    original retrieval order rather than blocking the answer.
                  </p>
                </div>
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
                Not tracked for this pipeline mode yet (Reflex RAG only so far - see RAG-ROADMAP.md Phase 132), or
                this answer was served from cache (nothing was actually sent this call).
              </p>
            </div>
          )}
          </div>
        )}

        {activeTopTab === "techStack" && (
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

        {showingRetrieval && activeRetrievalLeaf === "citations" && (
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
            {sources.length > 0 && (
              <p className="dev-note-inline">
                Listed #1 (best) downward. The score shown per chunk (similarity/MMR for vector search, BM25 for
                keyword, Reciprocal Rank Fusion for hybrid) is the vector store's own initial ranking - but this
                list's actual order reflects one more step after that: a single LLM call reranks the whole retrieved
                batch by relevance to the query before generation ever sees it (see the Chunk Reranking panel under
                Response Generation &gt; LLM Context for details). That reranked order is what synthesis (the
                Reviewer agent on multi-agentic-rag, or Reflex RAG's single generation call) actually receives.
              </p>
            )}
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

        {showingTestingStrategy && activeTestingStrategyLeaf === "goldenDataset" && (
          <div className="explainability-tab-panel">
            <div className="panel panel-success">
              <span className="panel-eyebrow">What it is</span>
              <p className="dev-note-inline">
                A human-written set of questions and expected answers, grounded in the real HR benefits PDFs - 29
                real cases today (<span className="mono">resources/golden_dataset/golden_dataset.json</span>). The
                only one of this project's 3 test stores whose "correct answer" is actually verified by a person,
                which is exactly why it's the only one trusted to block a deploy.
              </p>
            </div>
            <div className="panel panel-info">
              <span className="panel-eyebrow">What it's for</span>
              <p className="dev-note-inline">
                The CI release gate - <span className="mono">scripts/run_release_gate.py</span> runs every case
                through the real pipeline and issues a PASS/REVIEW/BLOCK verdict before a change is allowed to
                merge. Small by nature (a human has to write and verify every case), high trust by design.
              </p>
            </div>
          </div>
        )}

        {showingTestingStrategy && activeTestingStrategyLeaf === "syntheticDataset" && (
          <div className="explainability-tab-panel">
            <div className="panel panel-info">
              <span className="panel-eyebrow">What it is</span>
              <p className="dev-note-inline">
                Generated programmatically (an LLM given a real KB chunk, asked to produce varied phrasings) rather
                than hand-written - cheap to grow into the hundreds, but the generated "expected answer" is{" "}
                <strong>not</strong> human-verified, so it's never trusted the way a Golden Dataset case is.
              </p>
            </div>
            <div className="panel panel-info">
              <span className="panel-eyebrow">Golden vs. Synthetic - the real trade-off</span>
              <p className="dev-note-inline">
                Golden buys trust at the cost of scale; Synthetic buys scale (hundreds of phrasings/edge cases a
                person wouldn't think to write) at the cost of trust. Neither replaces the other - this project
                keeps both deliberately, plus a third store (Live Queries) for a third question: what are people
                actually asking.
              </p>
            </div>
            <div className="panel panel-success">
              <span className="panel-eyebrow">A real connection between the two</span>
              <p className="dev-note-inline">
                The Admin Dashboard's "Promote to Synthetic" action lets a real, well-scoring live query graduate
                into this store directly - the one place today where these otherwise-separate stores actually
                feed into each other, gated by the same groundedness threshold used for the LTM gate below.
              </p>
            </div>
          </div>
        )}

        {showingTestingStrategy && activeTestingStrategyLeaf === "liveQueries" && (
          <div className="explainability-tab-panel">
            <div className="panel panel-info">
              <span className="panel-eyebrow">What it is</span>
              <p className="dev-note-inline">
                Real questions from real production traffic, captured and scored by the same live groundedness
                judge every production answer already gets - the "reality check" the other two stores can't give,
                since neither Golden nor Synthetic reflects what people are actually asking.
              </p>
            </div>
            <div className="panel panel-success">
              <span className="panel-eyebrow">The LTM quality gate</span>
              <p className="dev-note-inline">
                Only queries scoring above a threshold (today: <strong>0.6</strong>, runtime-editable in Settings -
                not hardcoded) get promoted to <span className="mono">is_ltm = true</span> - a curated pool of
                real-world questions the system is already answering well. Decided by{" "}
                <span className="mono">maybe_capture_live_query()</span> in <span className="mono">eval_threshold.py</span>.
              </p>
            </div>
            <div className="panel panel-info">
              <span className="panel-eyebrow">The honest limit</span>
              <p className="dev-note-inline">
                There's no pre-known "correct answer" here, only a live quality score - a confidently-wrong answer
                that still sounds grounded can still clear the threshold. The score is a proxy for quality, not a
                guarantee.
              </p>
            </div>
          </div>
        )}

        {showingTestingStrategy && activeTestingStrategyLeaf === "langsmith" && (
          <div className="explainability-tab-panel">
            <div className="panel panel-info">
              <span className="panel-eyebrow">What LangSmith actually traces</span>
              <p className="dev-note-inline">
                The step-by-step record of one request - every LLM call, its latency, its token usage. A debugging/
                observability tool, not a dataset of questions and scores.
              </p>
            </div>
            <div className="panel panel-info">
              <span className="panel-eyebrow">Local vs. production - kept in separate projects</span>
              <p className="dev-note-inline">
                <span className="mono">HRB_CHATBOT_LOCAL</span>/<span className="mono">HRB_CHATBOT_PROD</span> pick
                which LangSmith project a trace lands in (<span className="mono">{"{base}_local"}</span> or{" "}
                <span className="mono">{"{base}_prod"}</span>) so local dev traffic and real production traffic
                never land mixed together under the same name.
              </p>
            </div>
            <div className="panel panel-warning">
              <span className="panel-eyebrow">The common mix-up, worth being precise about</span>
              <p className="dev-note-inline">
                LangSmith and the 3 stores on the other tabs here are <strong>two separate systems</strong>, not
                one. LangSmith captures traces; Golden/Synthetic/Live Queries capture questions and their quality
                scores, held in this project's own Postgres, viewed through its own Admin Dashboard - not
                LangSmith's UI. Nothing wires the two together today: a trace you see in LangSmith is not the same
                row you'd see in the Live Queries tab, even for the same real request.
              </p>
            </div>
          </div>
        )}

        {showingPlatformArchitecture && (
          <div className="explainability-tab-panel">
            <div className="panel panel-info">
              <a
                className="link-button"
                href="https://github.com/rvsree/hrb_emp_assist/blob/master/docs/architecture/platform-overview.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the full architecture hub &rarr;
              </a>
              <p className="dev-note-inline">
                Every business capability, which of this platform's real repos serves it, and one diagram tying it
                all together - the one-page starting point for the whole system, not just this chat.
              </p>
            </div>

            {activePlatformArchitectureLeaf === "ragIngestion" && (
              <>
                <div className="panel panel-success">
                  <span className="panel-eyebrow">Purpose</span>
                  <p className="dev-note-inline">
                    Every retrieval mode (GenAI RAG Chat, Single-Agentic RAG, Multi-Agentic RAG) reads from the same
                    vector index - this pipeline is what writes it: extract PDF text -&gt; chunk -&gt; embed -&gt;
                    index, one call, synchronously, in-request.
                  </p>
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">6 chunking strategies, auto-selected when none is named</span>
                  <p className="dev-note-inline">
                    <strong>fixed</strong>, <strong>recursive</strong>, <strong>markdown</strong>,{" "}
                    <strong>html</strong>, <strong>none</strong> (whole-document), plus explicit-only{" "}
                    <strong>semantic</strong> and <strong>document_structure</strong>. Auto-selection is a real,
                    ordered decision (not a guess): markdown heading lines found -&gt; <span className="mono">markdown</span>;
                    else an HTML heading tag found -&gt; <span className="mono">html</span>; else short enough to
                    stay whole -&gt; <span className="mono">none</span>; else -&gt; <span className="mono">recursive</span>{" "}
                    (the default for everything else).
                  </p>
                </div>
                <div className="panel panel-info">
                  <span className="panel-eyebrow">Dedup and document replacement</span>
                  <p className="dev-note-inline">
                    A content-hash match against an existing document short-circuits the whole pipeline - identical
                    bytes never create a second document. One document replacing another is tracked explicitly
                    (<span className="mono">supersedes</span>/<span className="mono">is_current</span>), not
                    inferred.
                  </p>
                </div>
                <div className="panel panel-warning">
                  <span className="panel-eyebrow">Qdrant - not built yet</span>
                  <p className="dev-note-inline">
                    No Qdrant client, gateway entry, or enum value exists anywhere in the current codebase today -
                    a stated near-term direction, not a shipped feature. Flagged here so this tab never implies
                    support that doesn't exist yet.
                  </p>
                </div>
              </>
            )}

            {activePlatformArchitectureLeaf === "productionIncidents" && (
              <>
                <div className="panel panel-warning">
                  <span className="panel-eyebrow">Incident - CI/test runs polluting real production data</span>
                  <p className="dev-note-inline">
                    <strong>What broke:</strong> every CI/release-gate run against the golden dataset was writing a
                    fake row into <span className="mono">live_queries</span> - the table meant for real production
                    traffic only.
                  </p>
                  <p className="dev-note-inline">
                    <strong>Root cause:</strong> the release gate calls the exact same pipeline functions real
                    traffic does, with nothing gating the capture step on whether the caller was a real request. A
                    second, worse source was found while fixing the first: 4 test files never mocked the DB
                    gateway one shared helper function used, so any test with non-empty fake retrieval results was
                    silently writing real rows on every local test run too.
                  </p>
                  <p className="dev-note-inline">
                    <strong>How it was caught:</strong> a direct query of the live table, confirmed 746 of 2029 rows
                    were fake (recognizable by a <span className="mono">NULL employee_id</span> - a value no real
                    authenticated request can ever produce, since it's a required field).
                  </p>
                  <p className="dev-note-inline">
                    <strong>Fix:</strong> a <span className="mono">capture_as_live_query</span> flag the release
                    gate explicitly sets to false; the polluted rows deleted after confirming the signature was
                    safe.
                  </p>
                </div>
                <div className="panel panel-warning">
                  <span className="panel-eyebrow">Incident - local testing silently poisoned the production cache</span>
                  <p className="dev-note-inline">
                    <strong>What broke:</strong> the Admin Dashboard showed a document that 404'd when opened, and
                    separately showed a real dataset as empty when it wasn't.
                  </p>
                  <p className="dev-note-inline">
                    <strong>Root cause:</strong> local development and production point at the <strong>same</strong>{" "}
                    shared Redis instance, and a 24h admin-dashboard cache had no separation between the two
                    environments - routine local testing was writing locally-sourced list data into the exact
                    cache key production itself read from.
                  </p>
                  <p className="dev-note-inline">
                    <strong>How it was caught:</strong> direct comparison of local and production's own{" "}
                    <span className="mono">REDIS_URL</span> values, confirmed to resolve to the same host.
                  </p>
                  <p className="dev-note-inline">
                    <strong>Fix:</strong> the cache key prefix is now scoped by environment (the same
                    local/production split this project's own LangSmith tracing already used), so the two can
                    never collide again.
                  </p>
                </div>
              </>
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
