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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  sources?: RetrievedChunk[];
  modelUsed?: string;
  feedback?: FeedbackVote | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}
