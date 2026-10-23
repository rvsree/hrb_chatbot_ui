export type Role = "employee" | "manager" | "hr_support" | "admin" | "employee_admin";

export interface UserProfile {
  employee_id: string;
  full_name: string;
  role: Role;
}

export interface RetrievedChunk {
  document_id: string;
  filename: string;
  chunk_index: number;
  text: string;
  score: number | null;
  // Phase 221 - hybrid search only: which list(s) (sparse/dense) found
  // this chunk before Reciprocal Rank Fusion merged them. Null otherwise.
  matched_by: string[] | null;
}

export interface AnswerInfo {
  answer: string;
  model_used: string;
}

export interface RetrievalInfo {
  vector_db: string;
  search_strategy: string;
  applied_filter: Record<string, unknown> | null;
  /** Phase 232 - how many documents Document ACL (Phase 231) excluded from this answer's candidate pool. 0 = none. */
  acl_denied_count: number;
  sources: RetrievedChunk[];
}

export interface TokenUsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LatencyInfo {
  total: number;
  retrieval: number | null;
  generation: number | null;
  eval: number | null;
}

export interface EvalScores {
  groundedness: number;
  groundedness_verdict: "GROUNDED" | "PARTIAL" | "HALLUCINATED";
  groundedness_explanation: string | null;
  completeness: number;
  completeness_verdict: "COMPLETE" | "PARTIAL" | "INCOMPLETE";
  completeness_explanation: string | null;
  retrieval_precision: number | null;
  retrieval_relevant_chunk_indices: number[];
  retrieval_precision_explanation: string | null;
  // Phase 219 - NOT true recall (see the "?" tooltip this renders next to) -
  // an estimate relative to a wider exact-KNN candidate pool, pool size
  // included so the estimate's own bound is visible, not hidden.
  retrieval_recall_estimate: number | null;
  retrieval_f1_estimate: number | null;
  retrieval_recall_pool_size: number | null;
  // Phase 225 - the real denominator behind retrieval_recall_estimate:
  // how many chunks were judged relevant across the whole wider pool,
  // before scoping down to just the originally-retrieved subset.
  retrieval_recall_relevant_count: number | null;
  // Phase 226 - true when enable_corrective_retry was on AND the first
  // retrieval's own precision fell below eval_score_threshold, so
  // retrieval ran a second time (doubled top_k) before this answer was
  // generated.
  retrieval_retry_attempted: boolean;
  judge_model_used: string | null;
  below_threshold: boolean;
  below_threshold_metrics: string[];
}

export interface ChatHistoryMessage {
  role: string;
  content: string;
}

export interface McpToolCallDetail {
  tool_name: string;
  arguments: Record<string, unknown>;
  raw_result: string[];
}

export interface LlmContextTurn {
  label: string;
  latency_ms: number | null;
  system_prompt: string | null;
  human_message: string | null;
  chat_history: ChatHistoryMessage[];
  response: string | null;
}

export interface LlmContextInfo {
  turns: LlmContextTurn[];
  mcp_tool_calls: McpToolCallDetail[];
}

// Phase 224 - real per-answer NeMo Guardrails status. "blocked" is only
// reachable on the output check - a blocked input raises a 422 before any
// response is built, so it never reaches this field at all.
// Phase 229 - one configured NeMo Guardrails flow that actually ran for
// this check, with NeMo's own real decision log - live-verified to
// include every configured rail, not just the one that blocked/modified
// something, so a clean pass is still demonstrable, not just asserted.
export interface ActivatedRailInfo {
  name: string;
  decisions: string[];
  stop: boolean;
}

export interface GuardrailCheckStatus {
  status: "pass" | "modified" | "blocked";
  rail: string | null;
  activated_rails: ActivatedRailInfo[];
}

export interface GuardrailInfo {
  input: GuardrailCheckStatus;
  output: GuardrailCheckStatus;
}

export interface ExplainabilityInfo {
  request_id: string;
  served_from_cache: boolean;
  llm_call_count: number;
  latency_ms: LatencyInfo;
  token_usage: TokenUsageInfo | null;
  routed_to: string | null;
  eval_scores: EvalScores | null;
  temperature: number | null;
  llm_context: LlmContextInfo | null;
  guardrails: GuardrailInfo;
}

export interface RagQueryResponse {
  query: string;
  answer_info: AnswerInfo;
  retrieval_info: RetrievalInfo;
  explainability_info: ExplainabilityInfo;
  tools_used: ToolCallInfo[];
  conversation_id: string | null;
}

// Phase 161 - real evidence of one SendEmailWithAnswer attempt, sent or
// failed, so a failure (e.g. SES_SENDER_EMAIL not configured) is visible
// instead of indistinguishable from "no email asked for at all".
export interface EmailEvidence {
  recipient_email: string;
  subject: string;
  sent: boolean;
  message: string;
  attached_files: string[];
  sent_at: string;
}

// Phase 136 (backend) - the Chat GenAI Workflow's own, deliberately small
// response shape. No vector_db/search_strategy/citations - none apply,
// there's no vector store or persisted KB in this path at all.
export interface AdhocDocumentChatResponse {
  question: string;
  answer: string;
  files_used: string[];
  // Phase 145 - which queries the agent actually ran via SearchWeb,
  // reusing multi-agentic-rag's existing Tavily integration. Empty when
  // the question didn't need the web.
  web_searches: string[];
  email_sent_to: string | null;
  email_evidence: EmailEvidence | null;
  // Phase 163 - always present now; send it back as AdhocChatOptions.sessionId
  // on the next turn in this same chat to continue its memory.
  session_id: string;
  model_used: string;
  iterations: number;
  llm_call_count: number;
  token_usage: TokenUsageInfo | null;
  latency_ms: LatencyInfo;
}

export type UploadResultStatus = "uploaded" | "duplicate" | "rejected";

export interface DocumentUploadResult {
  filename: string;
  document_id: string | null;
  status: UploadResultStatus;
  uploaded_by: string | null;
  error: string | null;
  error_code: string | null;
  message: string | null;
  file_size_bytes: number | null;
}

export interface DocumentUploadResponse {
  uploaded_count: number;
  duplicate_count: number;
  rejected_count: number;
  results: DocumentUploadResult[];
}

export type FeedbackVote = "helpful" | "not_quite";

export interface FeedbackRecord {
  id: number;
  employee_id: string;
  conversation_id: string | null;
  message_id: string;
  vote: FeedbackVote;
  reason_tags: string[];
  notes: string | null;
  question: string;
  answer: string;
  created_at: string;
}

export interface FeedbackListResponse {
  count: number;
  feedback: FeedbackRecord[];
}

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  started_at: string;
  last_updated_at: string;
}

export interface ConversationListResponse {
  count: number;
  conversations: ConversationSummary[];
}

export interface ConversationTurnRecord {
  role: "human" | "ai";
  content: string;
  created_at: string;
}

export interface ConversationDetailResponse {
  conversation_id: string;
  turns: ConversationTurnRecord[];
}

// Phase 165 - the sidebar's own "GenAI Chat Workflow History" section,
// same shape as ConversationSummary/-DetailResponse above but backed by
// chat_workflow_store.py (Phase 163) instead of conversation_memory.py.
export interface AdhocSessionSummary {
  session_id: string;
  session_title: string;
  started_at: string;
  last_active: string;
  turn_count_total: number;
}

export interface AdhocSessionListResponse {
  count: number;
  sessions: AdhocSessionSummary[];
}

export interface AdhocSessionTurn {
  role: "human" | "ai";
  content: string;
  created_at: string;
}

export interface AdhocSessionDetailResponse {
  session_id: string;
  turns: AdhocSessionTurn[];
}

export type ChatMode = "genai-rag" | "single-agentic-rag" | "multi-agentic-rag" | "auto-agentic-rag";

// Matches common/enums.py::SearchStrategy (Phase 131 added keyword/hybrid).
// "similarity" is plain vector search, "mmr" trades some relevance for less
// redundant results, "keyword" is real BM25 lexical ranking, "hybrid" merges
// "keyword" and "similarity" via Reciprocal Rank Fusion.
// Phase 218 - "knn" added: exact, brute-force cosine search, computed
// directly rather than approximated by either backend's own HNSW index.
// Phase 252 - "dynamic" added: auto-picks one of the above per query
// server-side (dynamic_strategy_selector.py); the response's own
// retrieval.search_strategy always reports the resolved real value.
export type SearchStrategy = "similarity" | "mmr" | "keyword" | "hybrid" | "knn" | "dynamic";

// Phase 228 - narrower than SearchStrategy above on purpose:
// search_knowledge_base() (the tool both single-agentic-rag and multi-
// agentic-rag call) only ever understands these 2 values - "keyword"/
// "hybrid"/"knn" would silently no-op there, the exact "decorative
// control" bug this project avoids elsewhere.
export type AgentSearchStrategy = "similarity" | "mmr";

// Phase 215 - judge_model/eval_score_threshold are common to all 3
// pipelines (eval/judge scoring applies everywhere), not genai-rag-only.
// Phase 228 - agentSearchStrategy is a different NAME than GenaiRagOptions'
// own `searchStrategy` deliberately (not just a narrower type) - the two
// are genuinely different fields (a per-call AGENT DEFAULT here vs. a
// directly-applied request param there), and a same-named field with a
// narrower type here would be an invalid TS interface override once
// GenaiRagOptions below redeclares `searchStrategy` with the wider enum.
export interface EvalRequestOptions {
  judgeModel?: string;
  evalScoreThreshold?: number;
  agentSearchStrategy?: AgentSearchStrategy;
  // Phase 243 - multi-agentic-rag only (classification_options.planner_model);
  // AgenticRagRequest (single-agentic-rag) has no classification_options
  // field at all, so client.ts's askAgenticQuery never sends this - shared
  // on this interface only because askAgenticQuery/askMultiAgenticQuery
  // already share EvalRequestOptions as a whole, same as agentSearchStrategy above.
  plannerModel?: string;
  // Phase 244 - applies identically to all 3 modes (unlike plannerModel above) -
  // guardrails run on every pipeline, so this is genuinely shared, not just
  // co-located on this interface for convenience.
  guardrailsModel?: string;
}

export interface GenaiRagOptions extends EvalRequestOptions {
  temperature: number;
  searchStrategy: SearchStrategy;
  lambdaMult?: number;
  topK?: number;
  // Phase 226 - genai-rag only (search_options is genai-rag-only too) -
  // retries retrieval once, before any answer is generated, when the
  // first retrieval's own live precision is below evalScoreThreshold.
  // No-op without evalScoreThreshold set.
  enableCorrectiveRetry?: boolean;
  // Phase 243 - genai-rag only (classification_options.decompose_model).
  decomposeModel?: string;
}

// tool_type: Phase 126 - which kind of backend this call hit. Not a closed
// union - new values can appear as this project's tool/agent set grows
// (common/rag_core/tool_classification.py's own fallback is "other"), so
// rendering code must treat any unrecognized string as "Other", not crash.
export type ToolType = "vector_db" | "mcp" | "web_search" | "sql_db" | "other";

export interface ToolCallInfo {
  tool_name: string;
  tool_input: string;
  tool_type: ToolType;
  latency_ms: number | null;
  success: boolean;
  iteration: number | null;
  // Phase 216 - the agent's own strategy choice for a search_knowledge_base
  // call ("similarity"/"mmr"). Null for every other tool.
  search_strategy: string | null;
}

export interface AgentTaskInfo {
  agent: string;
  focus: string;
  reasoning: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  sources?: RetrievedChunk[];
  modelUsed?: string;
  feedback?: FeedbackVote | null;
  toolsUsed?: ToolCallInfo[];
  iterations?: number;
  tasks?: AgentTaskInfo[];
  // Phase 240 - set only for an "Auto" mode turn, naming which of
  // single-/multi-agentic-rag was actually picked (or escalated to).
  resolvedMode?: "single-agentic-rag" | "multi-agentic-rag";
  explainability?: ExplainabilityInfo;
  retrievalInfo?: RetrievalInfo;
  // Phase 223 - the Eval Score Threshold actually sent with this request
  // (Settings' RAG Config tab), so the Explainability panel can show the
  // real target number next to eval_scores.below_threshold, not just the
  // boolean. Undefined when no threshold was set that turn.
  evalScoreThreshold?: number;
  // 2026-10-19 round 3 - genai-rag only: whether "Retry Once on Low
  // Retrieval Score" was armed for THIS request, so Gate 4's own
  // Explainability panel can say "retry was off" vs. "retry was on but
  // didn't need to fire" instead of collapsing both into one ambiguous
  // "false" on eval_scores.retrieval_retry_attempted.
  enableCorrectiveRetry?: boolean;
  // Phase 136 - set only for an answer from the Chat GenAI Workflow
  // (files attached directly in the composer) - no vector DB/MCP access,
  // a different, much smaller Explainability view applies. Phase 145
  // added SearchWeb (reusing multi-agentic-rag's Tavily integration) as
  // this pipeline's one deliberate exception - still no vector DB/MCP.
  adhoc?: {
    filesUsed: string[];
    webSearches: string[];
    emailSentTo: string | null;
    // Phase 161 - sent OR failed evidence of the SendEmailWithAnswer
    // attempt; null only when no email was requested at all this turn.
    emailEvidence: EmailEvidence | null;
    llmCallCount: number;
    iterations: number;
    tokenUsage: TokenUsageInfo | null;
    totalMs: number;
  };
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
  messages: ChatMessage[];
  createdAt: number;
  // Phase 165 - true when id is a chat_workflow_store session_id (the
  // GenAI Chat Workflow), not a conversation_memory conversation_id - the
  // sidebar's "GenAI Chat Workflow History" section filters on this,
  // rather than inspecting message content, so it still works for an
  // entry whose messages haven't been lazy-loaded yet.
  isAdhocWorkflow?: boolean;
}

export interface VersioningInfo {
  document_version: number;
  is_current: boolean;
  supersedes: string | null;
  superseded_by: string | null;
}

export interface ChunkInfo {
  chunking_strategy: string | null;
  chunk_size: number | null;
  chunk_overlap: number | null;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  file_path: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  last_indexed_at: string | null;
  chunk_count: number;
  file_size_bytes: number;
  uploaded_by: string | null;
  versioning_info: VersioningInfo | null;
  chunk_info: ChunkInfo | null;
  embedding_model: string | null;
}

export interface DocumentListResponse {
  count: number;
  documents: DocumentRecord[];
}

// Phase 89 (backend, already live) - POST .../documents/presigned-upload.
// Nothing has been indexed yet at response time - poll GET /documents/{id}
// (DocumentRecord.status) for the real result.
export interface PresignedUploadResponse {
  document_id: string;
  upload_url: string;
  expires_in_seconds: number;
  status: string;
}

// Phase 162 - "Request Unpaid Leave", a second A2A/HITL workflow,
// deliberately separate from the GenAI Chat Workflow and its own
// presigned-upload shape above (a different S3 bucket - see
// hrb_chatbot_v2's s3_upload_client.py for why).
export interface LeaveDocumentUploadUrlResponse {
  upload_url: string;
  key: string;
  expires_in_seconds: number;
}

// Phase 165 - the 4 specialist-reviewed leave types, must keep matching
// common/enums.py::LeaveTypeCode.
export type LeaveTypeCode = "UNPAID" | "CRITICAL_CAREGIVER" | "STD" | "LTD";

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  UNPAID: "Unpaid Leave",
  CRITICAL_CAREGIVER: "Critical CareGiver Leave",
  STD: "Short-Term Disability",
  LTD: "Long-Term Disability",
};

export interface UnpaidLeaveRequestResponse {
  request_id: number;
  employee_id: string;
  leave_type: string;
  status: string;
  is_repeat_within_12_months: boolean;
  hitl_request_context_id: number;
  hitl_status: string;
  days: number;
}

export interface HitlRequestSummary {
  hitl_request_context_id: number;
  request_type: string;
  employee_id: string | null;
  query: string;
  context: {
    leave_request_id?: number;
    start_date?: string;
    end_date?: string;
    days?: number;
    purpose?: string;
    leave_type?: string;
    is_repeat_within_12_months?: boolean;
    document_reference?: string | null;
  };
  status: string;
  assigned_to: string | null;
  created_at: string | null;
}

// Phase 165
export interface LeaveDocumentDownloadUrlResponse {
  download_url: string;
  original_filename: string;
  expires_in_seconds: number;
}

export interface MyLeaveRequestSummary {
  request_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  purpose: string;
  status: string;
  decision: string | null;
  hr_comments: string | null;
  hr_specialist_name: string | null;
  created_at: string | null;
  responded_at: string | null;
  // Phase 172 - see HrLeaveRequestSummary's own comment above.
  task_state: string | null;
  review_brief: string | null;
  decision_message: { role: string; parts: { type: string; content: string }[] } | null;
  produced_artifacts: Record<string, unknown>[];
}

export interface MyLeaveRequestsResponse {
  total: number;
  requests: MyLeaveRequestSummary[];
}

export interface PendingHitlRequestsResponse {
  total: number;
  requests: HitlRequestSummary[];
}

// Phase 168 (round 2) - the HR specialist grid: every leave request
// across every employee, any status, with full review detail.
export interface HrLeaveRequestSummary {
  hitl_request_context_id: number;
  request_id: number;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  purpose: string;
  status: string;
  decision: string | null;
  hr_comments: string | null;
  hr_specialist_name: string | null;
  created_at: string | null;
  responded_at: string | null;
  // Phase 172 - A2A-shaped fields, additive alongside status/decision/
  // hr_comments above (unchanged) - null until the agent graph actually
  // produces them.
  task_state: string | null;
  review_brief: string | null;
  decision_message: { role: string; parts: { type: string; content: string }[] } | null;
  produced_artifacts: Record<string, unknown>[];
}

export interface HrLeaveRequestsResponse {
  total: number;
  requests: HrLeaveRequestSummary[];
}

export interface ResolveHitlRequestResponse {
  hitl_request_context_id: number;
  status: string;
  decision: string;
  response: string;
  related_leave_request_updated: boolean;
}

export interface AgenticRagResponse {
  query: string;
  answer: string;
  tools_used: ToolCallInfo[];
  sources: RetrievedChunk[];
  iterations: number;
  explainability_info: ExplainabilityInfo;
  conversation_id: string | null;
  // Phase 240 - set only when returned from POST /v1/rag-retrieval/query
  // (the auto-router). Null/absent on this model's own direct, forced-mode endpoint.
  resolved_mode?: "single-agentic-rag" | "multi-agentic-rag" | null;
}

export interface MultiAgenticRagResponse {
  query: string;
  answer: string;
  tasks: AgentTaskInfo[];
  tools_used: ToolCallInfo[];
  sources: RetrievedChunk[];
  iterations: number;
  explainability_info: ExplainabilityInfo;
  conversation_id: string | null;
  // Phase 240 - set only when returned from POST /v1/rag-retrieval/query
  // (the auto-router, including an escalation from single-agentic-rag).
  resolved_mode?: "single-agentic-rag" | "multi-agentic-rag" | null;
}

// Phase 168 - admin dashboard (view + hard-delete across KB documents,
// conversations, feedback, leave requests/HITL reviews). KB documents and
// feedback reuse DocumentRecord/FeedbackRecord above unchanged.
export interface AdminConversationSummary {
  conversation_id: string;
  employee_id: string | null;
  title: string;
  started_at: string;
  last_updated_at: string;
}

export interface AdminConversationListResponse {
  count: number;
  conversations: AdminConversationSummary[];
}

export interface AdminDeleteConversationResponse {
  conversation_id: string;
  turns_deleted: number;
}

export interface AdminDeleteFeedbackResponse {
  feedback_id: number;
  deleted: boolean;
}

export interface AdminDeleteLeaveRequestResponse {
  hitl_request_context_id: number;
  deleted_hitl_request: boolean;
  deleted_specialist_leave_reviews: number;
  deleted_leave_request: boolean;
  deleted_document_count: number;
}

// Phase 170 (round 1) - the admin-only docs viewer.
export interface AdminDocSummary {
  id: number;
  feature_name: string;
  doc_title: string;
  doc_type: string;
  doc_version: number;
  created_at: string;
  updated_at: string;
  last_synced_at: string;
}

export interface AdminDocListResponse {
  count: number;
  docs: AdminDocSummary[];
}

// Phase 181 - Deployment Dashboard's golden-dataset viewer. raw_case is the
// full original JSON case object (fields vary by dataset), not re-typed
// field-by-field here.
export interface GoldenDatasetCaseSummary {
  id: number;
  case_key: string;
  dataset: string;
  category: string | null;
  query: string | null;
  raw_case: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GoldenDatasetListResponse {
  count: number;
  cases: GoldenDatasetCaseSummary[];
}

// Phase 182 - Deployment Dashboard's Eval Runs history, persisted by
// scripts/run_release_gate.py on every real run.
export interface EvalRunSummary {
  id: number;
  run_at: string;
  decision: string;
  flags: string[];
  aggregated_scores: Record<string, number>;
  total_cases: number;
  scored_cases: number;
  failed_case_ids: string[];
  retrieval_k: number;
}

export interface EvalRunListResponse {
  count: number;
  runs: EvalRunSummary[];
}

export interface EvalRunCaseDetail {
  case_id: string;
  category: string | null;
  scores: Record<string, number>;
  status: string;
}

export interface EvalRunDetail extends EvalRunSummary {
  cases: EvalRunCaseDetail[];
}

// Phase 183 - Deployment Dashboard's CI/Build Status tab.
export interface WorkflowRunSummary {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_commit_message: string;
  html_url: string;
  created_at: string;
}

// Phase 235 - workflow_file/display_name/total_count/has_more replace the
// old fixed `ci`/`deploy` pair, which only ever fit backend's own 2
// workflow files - a generic list so it naturally renders however many
// workflow files the selected application actually has.
export interface WorkflowStatus {
  workflow_file: string;
  display_name: string;
  runs: WorkflowRunSummary[];
  total_count: number;
  has_more: boolean;
  error: string | null;
}

export interface CiStatusResponse {
  application: Application;
  page: number;
  workflows: WorkflowStatus[];
  error: string | null;
}

// Phase 184 - Deployment Dashboard's Live Metrics tab. No cost_usd field -
// no verified per-model price table exists in this project yet.
export interface PipelineMetricsRow {
  pipeline: string;
  status: string;
  request_count: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_tokens: number | null;
}

export interface RequestMetricsResponse {
  window_hours: number;
  rows: PipelineMetricsRow[];
}

export interface AdminDocContentResponse {
  download_url: string;
  expires_in_seconds: number;
}

// Phase 186 - FAQ submission: real-time LLM first-pass answer, then
// human/Claude review before publishing.
export interface FaqSubmissionRecord {
  id: number;
  employee_id: string;
  query: string;
  external_llm_answer: string | null;
  internal_review_status: string;
  answer_restructuring_status: string;
  final_answer: string | null;
  published: boolean;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaqSubmissionListResponse {
  count: number;
  submissions: FaqSubmissionRecord[];
}

export interface PublishedFaq {
  id: number;
  query: string;
  final_answer: string | null;
}

export interface PublishedFaqListResponse {
  count: number;
  faqs: PublishedFaq[];
}

// Phase 187 - Interview Q&A as real, editable DB rows (not just static
// HTML) - the 7-part answer structure plus tech_stack/feature_references
// for jumping to the real implementing code.
export interface KeywordEntry {
  term: string;
  definition: string;
}

export interface FeatureReference {
  label: string;
  file_path: string;
}

export interface InterviewQaCardFields {
  topic: string;
  topic_order: number;
  card_order: number;
  question: string;
  hint: string | null;
  concept: string | null;
  situation: string | null;
  task: string | null;
  action: string | null;
  result: string | null;
  project_link: string | null;
  leadership_angle: string | null;
  trade_offs: string[];
  keywords: KeywordEntry[];
  tech_stack: string[];
  feature_references: FeatureReference[];
}

export interface InterviewQaCard extends InterviewQaCardFields {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface InterviewQaListResponse {
  count: number;
  cards: InterviewQaCard[];
}

// Phase 188 - CI/CD Pipeline Visibility: one commit's full logical
// pipeline, stitched together from however many GitHub Actions workflow
// files actually ran for it, plus its nearest eval-gate result if any.
export interface PipelineStepDetail {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PipelineJobDetail {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  steps: PipelineStepDetail[];
}

export interface PipelineWorkflowRun {
  workflow_file: string;
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  jobs: PipelineJobDetail[];
}

// Phase 233 - which of this project's real deployables the Pipeline
// stepper is showing. BACKEND/INGESTION_LAMBDA share one GitHub repo
// (hrb_chatbot_v2) but are different workflow files/deploy targets;
// LMS_MCP is a genuinely separate repo; FRONTEND has no GitHub Actions
// workflow at all - deployed manually, shown as a plain message via the
// existing `error` field, not a fabricated pipeline view.
export type Application = "backend" | "ingestion_lambda" | "lms_mcp" | "frontend";

// 2026-10-19 - user-requested rename, with 2 of the 4 adjusted from what
// was asked: "RAG Search" for the backend and plain "RAG Ingestion" for
// the Lambda would have implied a clean search/ingestion split across
// the two that doesn't exist - the backend's own synchronous path is
// still the PRIMARY way documents get indexed today, confirmed by
// reading ai/doc_processing/pipeline.py; the Lambda is the async
// alternative, not ingestion's only home. User confirmed these
// alternatives after that was flagged.
export const APPLICATION_LABELS: Record<Application, string> = {
  backend: "HRB Chatbot Backend",
  ingestion_lambda: "HRB Chatbot Async Ingestion",
  lms_mcp: "HRB LMS MCP Server",
  frontend: "HRB Chatbot UI",
};

export interface PipelineStatusResponse {
  head_sha: string;
  head_commit_message: string;
  head_branch: string;
  event: string;
  actor_login: string;
  runs: PipelineWorkflowRun[];
  eval_gate: EvalRunSummary | null;
  error: string | null;
}

// Phase 189 - persisted pipeline snapshots (persist-on-read), for offline/
// historical review past GitHub's own log retention window.
export interface PipelineSnapshotSummary {
  id: number;
  head_sha: string;
  head_commit_message: string;
  captured_at: string;
}

export interface PipelineSnapshotListResponse {
  count: number;
  snapshots: PipelineSnapshotSummary[];
}
