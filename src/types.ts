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
}

export interface AnswerInfo {
  answer: string;
  model_used: string;
}

export interface RetrievalInfo {
  vector_db: string;
  search_strategy: string;
  applied_filter: Record<string, unknown> | null;
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

export type ChatMode = "genai-rag" | "single-agentic-rag" | "multi-agentic-rag";

// Matches common/enums.py::SearchStrategy (Phase 131 added keyword/hybrid).
// "similarity" is plain vector search, "mmr" trades some relevance for less
// redundant results, "keyword" is real BM25 lexical ranking, "hybrid" merges
// "keyword" and "similarity" via Reciprocal Rank Fusion.
export type SearchStrategy = "similarity" | "mmr" | "keyword" | "hybrid";

export interface GenaiRagOptions {
  temperature: number;
  searchStrategy: SearchStrategy;
  lambdaMult?: number;
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
  explainability?: ExplainabilityInfo;
  retrievalInfo?: RetrievalInfo;
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

export interface WorkflowStatus {
  runs: WorkflowRunSummary[];
  error: string | null;
}

export interface CiStatusResponse {
  ci: WorkflowStatus;
  deploy: WorkflowStatus;
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
