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

export interface RagQueryResponse {
  query: string;
  answer_info: AnswerInfo;
  retrieval_info: RetrievalInfo;
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

export type ChatMode = "genai-rag" | "single-agentic-rag" | "multi-agentic-rag";

export interface ToolCallInfo {
  tool_name: string;
  tool_input: string;
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
}

export interface DocumentListResponse {
  count: number;
  documents: DocumentRecord[];
}

export interface AgenticRagResponse {
  query: string;
  answer: string;
  tools_used: ToolCallInfo[];
  iterations: number;
  conversation_id: string | null;
}

export interface MultiAgenticRagResponse {
  query: string;
  answer: string;
  tasks: AgentTaskInfo[];
  tools_used: ToolCallInfo[];
  iterations: number;
  conversation_id: string | null;
}
