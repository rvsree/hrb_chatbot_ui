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

export interface ExplainabilityInfo {
  served_from_cache: boolean;
  llm_call_count: number;
  latency_ms: LatencyInfo;
  token_usage: TokenUsageInfo | null;
  routed_to: string | null;
  eval_scores: EvalScores | null;
}

export interface RagQueryResponse {
  query: string;
  answer_info: AnswerInfo;
  retrieval_info: RetrievalInfo;
  explainability_info: ExplainabilityInfo;
  tools_used: ToolCallInfo[];
  conversation_id: string | null;
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

// Backend only supports these two (common/enums.py::SearchStrategy) -
// "similarity" is plain vector search, "mmr" trades some relevance for
// less redundant results. No keyword/hybrid/text-search backend exists.
export type SearchStrategy = "similarity" | "mmr";

export interface GenaiRagOptions {
  temperature: number;
  searchStrategy: SearchStrategy;
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
}

export interface DocumentListResponse {
  count: number;
  documents: DocumentRecord[];
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
