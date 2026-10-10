export type Role = "employee" | "manager" | "hr_support";

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
  completeness: number;
  completeness_verdict: "COMPLETE" | "PARTIAL" | "INCOMPLETE";
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

// Phase 136 (backend) - the Chat GenAI Workflow's own, deliberately small
// response shape. No vector_db/search_strategy/citations - none apply,
// there's no vector store or persisted KB in this path at all.
export interface AdhocDocumentChatResponse {
  question: string;
  answer: string;
  files_used: string[];
  email_sent_to: string | null;
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
}

export interface AgentTaskInfo {
  agent: string;
  focus: string;
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
  // (files attached directly in the composer) - no vector DB/MCP/web
  // search, a different, much smaller Explainability view applies.
  adhoc?: {
    filesUsed: string[];
    emailSentTo: string | null;
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
