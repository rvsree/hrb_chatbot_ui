import type {
  AdhocDocumentChatResponse,
  Application,
  AdhocSessionDetailResponse,
  AdhocSessionListResponse,
  AdminConversationListResponse,
  AdminDeleteConversationResponse,
  AdminDeleteDemoVisitorResponse,
  AdminDeleteFeedbackResponse,
  AdminDeleteLeaveRequestResponse,
  AdminDeleteLiveQueryResponse,
  AdminDocContentResponse,
  AdminDocListResponse,
  AgenticRagResponse,
  AppSettingResponse,
  AwsDemoStatusResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  DocumentListResponse,
  DocumentRecord,
  DocumentUploadResponse,
  DocumentUploadResult,
  DemoVisitorListResponse,
  FeedbackListResponse,
  FeedbackVote,
  CiStatusResponse,
  EvalRequestOptions,
  EvalRunDetail,
  EvalRunListResponse,
  FaqSubmissionListResponse,
  FaqSubmissionRecord,
  GenaiRagOptions,
  GrantWaiverResponse,
  RequestMetricsResponse,
  GoldenDatasetListResponse,
  HrLeaveRequestsResponse,
  InterviewQaCard,
  InterviewQaCardFields,
  InterviewQaListResponse,
  LeaveDocumentDownloadUrlResponse,
  LeaveDocumentUploadUrlResponse,
  LeaveTypeCode,
  LiveQueryListResponse,
  MultiAgenticRagResponse,
  MyLeaveRequestsResponse,
  PendingHitlRequestsResponse,
  PipelineSnapshotListResponse,
  PipelineStatusResponse,
  PresignedUploadResponse,
  PublishedFaqListResponse,
  RagQueryResponse,
  ResolveHitlRequestResponse,
  SyntheticDatasetCaseSummary,
  SyntheticDatasetListResponse,
  UnpaidLeaveRequestResponse,
  UserProfile,
} from "../types";

// Defaults to the live backend - no path prefix, matching hrb_chatbot_v2's
// Phase 94/95 state. Override with VITE_API_BASE_URL in .env for local dev.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://hrb-chatbot.rvsree.dev";

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Phase 157 - a 422's real, specific reason (e.g. "chunk_size: Input should
// be greater than or equal to 200") lives in FastAPI/Pydantic's own
// `details` array, which this function used to ignore entirely in favor of
// the generic top-level `error` string ("Request validation failed.") -
// exactly the unhelpful message the user reported.
function describeValidationDetail(detail: unknown): string {
  if (typeof detail !== "object" || detail === null) {
    return String(detail);
  }
  const record = detail as { loc?: unknown[]; msg?: unknown; input?: unknown };
  const field = Array.isArray(record.loc) && record.loc.length > 0 ? record.loc[record.loc.length - 1] : "value";
  // Pydantic prefixes a @model_validator's own raised ValueError with
  // "Value error, " - redundant once it's already labeled by field below.
  const rawMsg = typeof record.msg === "string" ? record.msg : "is invalid";
  const msg = rawMsg.startsWith("Value error, ") ? rawMsg.slice("Value error, ".length) : rawMsg;
  // A model-level validator's `input` is the whole submitted object, not
  // one value - showing that as "(got {...})" is noise, not help.
  const isPrimitive = record.input === null || typeof record.input !== "object";
  const gotSuffix = isPrimitive && record.input !== undefined ? ` (got ${JSON.stringify(record.input)})` : "";
  return `${field}: ${msg}${gotSuffix}`;
}

async function parseErrorAndThrow(response: Response): Promise<never> {
  let message = `Request failed with status ${response.status}`;
  let code = "UNKNOWN_ERROR";
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") {
      message = body.error;
    }
    if (body && Array.isArray(body.details) && body.details.length > 0) {
      message = body.details.map(describeValidationDetail).join("; ");
    }
    if (body && typeof body.code === "string") {
      code = body.code;
    }
  } catch {
    // Response wasn't JSON - keep the generic message/code above.
  }
  throw new ApiRequestError(message, code, response.status);
}

// Phase 163 - the 3 new, deliberately optional fields all default to "off"
// server-side too (no session_id -> a fresh session; no
// send_email_on_answer -> the model's own in-text decision is still the
// only trigger, unchanged).
export interface AdhocChatOptions {
  sessionId?: string;
  sendEmailOnAnswer?: boolean;
  ccEmail?: string;
}

export async function askAdhocDocumentChat(
  userProfile: UserProfile,
  question: string,
  files: File[],
  recipientEmail?: string,
  options?: AdhocChatOptions,
): Promise<AdhocDocumentChatResponse> {
  const formData = new FormData();
  formData.append("user_profile", JSON.stringify(userProfile));
  formData.append("question", question);
  if (recipientEmail) {
    formData.append("recipient_email", recipientEmail);
  }
  if (options?.sessionId) {
    formData.append("session_id", options.sessionId);
  }
  if (options?.sendEmailOnAnswer) {
    formData.append("send_email_on_answer", "true");
  }
  if (options?.ccEmail) {
    formData.append("cc_email", options.ccEmail);
  }
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(`${API_BASE_URL}/v1/adhoc-document-chat/query`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdhocDocumentChatResponse;
}

export async function askQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
  options?: GenaiRagOptions,
): Promise<RagQueryResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
      search_options: options
        ? {
            search_strategy: options.searchStrategy,
            lambda_mult: options.lambdaMult,
            top_k: options.topK,
            enable_corrective_retry: options.enableCorrectiveRetry,
          }
        : undefined,
      generation_options: options ? { temperature: options.temperature } : undefined,
      eval_options:
        options && (options.judgeModel || options.evalScoreThreshold !== undefined)
          ? { judge_model: options.judgeModel, eval_score_threshold: options.evalScoreThreshold }
          : undefined,
      // Phase 243 - genai-rag only.
      classification_options: options?.decomposeModel ? { decompose_model: options.decomposeModel } : undefined,
      // Phase 244 - shared across all 3 modes, top-level (not nested).
      guardrails_model: options?.guardrailsModel || undefined,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as RagQueryResponse;
}

export async function askAgenticQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
  options?: EvalRequestOptions,
): Promise<AgenticRagResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/single-agentic-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
      search_strategy: options?.agentSearchStrategy,
      eval_options:
        options && (options.judgeModel || options.evalScoreThreshold !== undefined)
          ? { judge_model: options.judgeModel, eval_score_threshold: options.evalScoreThreshold }
          : undefined,
      // Phase 244 - shared across all 3 modes, top-level (not nested).
      guardrails_model: options?.guardrailsModel || undefined,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AgenticRagResponse;
}

// Phase 240 - the auto-router. Same request shape as askAgenticQuery (the
// router's job is picking a pipeline, not a new request shape) - response
// is whichever shape the resolved pipeline actually returns, discriminated
// by its own resolved_mode field.
export async function askAutoRoutedQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
  options?: EvalRequestOptions,
): Promise<AgenticRagResponse | MultiAgenticRagResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
      search_strategy: options?.agentSearchStrategy,
      eval_options:
        options && (options.judgeModel || options.evalScoreThreshold !== undefined)
          ? { judge_model: options.judgeModel, eval_score_threshold: options.evalScoreThreshold }
          : undefined,
      guardrails_model: options?.guardrailsModel || undefined,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AgenticRagResponse | MultiAgenticRagResponse;
}

export async function askMultiAgenticQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
  options?: EvalRequestOptions,
): Promise<MultiAgenticRagResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/multi-agentic-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
      search_strategy: options?.agentSearchStrategy,
      eval_options:
        options && (options.judgeModel || options.evalScoreThreshold !== undefined)
          ? { judge_model: options.judgeModel, eval_score_threshold: options.evalScoreThreshold }
          : undefined,
      // Phase 243 - multi-agentic-rag only; AgenticRagRequest has no
      // classification_options field, so askAgenticQuery never sends this.
      classification_options: options?.plannerModel ? { planner_model: options.plannerModel } : undefined,
      // Phase 244 - shared across all 3 modes, top-level (not nested).
      guardrails_model: options?.guardrailsModel || undefined,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as MultiAgenticRagResponse;
}

export async function uploadDocuments(
  userProfile: UserProfile,
  files: File[],
  supersedesDocumentId?: string,
  chunkingStrategy?: string,
): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const payload: {
    user_profile: UserProfile;
    document_metadata?: { supersedes_document_id: string };
    chunk_info?: { chunking_strategy: string };
  } = {
    user_profile: userProfile,
  };
  if (supersedesDocumentId) {
    // Backend requires exactly one file when superseding - the caller
    // (DocumentsPage's "Replace" action) only ever passes one in that case.
    payload.document_metadata = { supersedes_document_id: supersedesDocumentId };
  }
  if (chunkingStrategy) {
    // Applies to every file in this batch - the backend has no per-file override.
    payload.chunk_info = { chunking_strategy: chunkingStrategy };
  }
  formData.append("payload", JSON.stringify(payload));

  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as DocumentUploadResponse;
}

export async function listDocuments(userProfile: UserProfile): Promise<DocumentListResponse> {
  // Phase 96: identity is query params here, not a body - the Fetch spec
  // forbids a body on GET/HEAD entirely (confirmed: fetch() throws before
  // any network call reaches the server).
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as DocumentListResponse;
}

export async function getDocument(userProfile: UserProfile, documentId: string): Promise<DocumentRecord> {
  // Same Phase 96 query-param identity pattern as listDocuments() - GET can't carry a body.
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents/${documentId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as DocumentRecord;
}

export async function requestPresignedUpload(
  userProfile: UserProfile,
  filename: string,
  contentType: string,
  chunkingStrategy?: string,
  supersedesDocumentId?: string,
): Promise<PresignedUploadResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents/presigned-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      filename,
      content_type: contentType,
      chunk_info: chunkingStrategy ? { chunking_strategy: chunkingStrategy } : undefined,
      document_metadata: supersedesDocumentId ? { supersedes_document_id: supersedesDocumentId } : undefined,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PresignedUploadResponse;
}

export async function uploadFileToS3(uploadUrl: string, file: File, contentType: string): Promise<void> {
  // Goes straight to S3, not this project's own backend - the presigned URL
  // itself carries the authorization, no header or credential needed here.
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });

  if (!response.ok) {
    throw new ApiRequestError(`S3 upload failed with status ${response.status}`, "S3_UPLOAD_FAILED", response.status);
  }
}

export async function deleteDocumentById(
  userProfile: UserProfile,
  documentId: string,
): Promise<{ document_id: string; filename: string; chunks_removed: number; deleted_by: string }> {
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents/${documentId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return await response.json();
}

export async function rechunkDocument(
  userProfile: UserProfile,
  documentId: string,
  chunkingStrategy: string,
  chunkSize?: number,
  chunkOverlap?: number,
): Promise<DocumentUploadResult> {
  // Phase 156 - chunk_size/chunk_overlap are now user-editable (previously
  // always omitted, letting the backend auto-pick a size). Omitted here
  // when not given, so the backend's own auto-selection still applies.
  const chunkInfo: Record<string, string | number> = { chunking_strategy: chunkingStrategy };
  if (chunkSize !== undefined) {
    chunkInfo.chunk_size = chunkSize;
  }
  if (chunkOverlap !== undefined) {
    chunkInfo.chunk_overlap = chunkOverlap;
  }

  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/ingest-document/documents/${documentId}/rechunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      chunk_info: chunkInfo,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as DocumentUploadResult;
}

export async function submitFeedback(
  userProfile: UserProfile,
  conversationId: string | null,
  messageId: string,
  vote: FeedbackVote,
  reasonTags: string[],
  notes: string | null,
  question: string,
  answer: string,
): Promise<{ id: number }> {
  const response = await fetch(`${API_BASE_URL}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      conversation_id: conversationId,
      message_id: messageId,
      vote,
      reason_tags: reasonTags,
      notes,
      question,
      answer,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as { id: number };
}

export async function listFeedback(userProfile: UserProfile): Promise<FeedbackListResponse> {
  // Phase 96 pattern: GET identity travels as query params, not a body.
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/feedback?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FeedbackListResponse;
}

export interface LoginResult {
  userProfile: UserProfile;
  mustResetSecretCode: boolean;
}

export async function validateLogin(
  employeeId: string,
  fullName: string,
  role: string,
  secretCode?: string,
  // Milestone 3 - false for the login page's own speculative blur-check
  // (does this secret code unlock the reveal icons?), so it never counts
  // toward the backend's lockout. True (the default) for a real Sign In click.
  countAsAttempt = true,
): Promise<LoginResult> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employee_id: employeeId,
      full_name: fullName,
      role,
      secret_code: secretCode,
      count_as_attempt: countAsAttempt,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  const body = (await response.json()) as { user_profile: UserProfile; must_reset_secret_code: boolean };
  return { userProfile: body.user_profile, mustResetSecretCode: body.must_reset_secret_code };
}

// Phase 171 - only reachable by an already-authenticated admin (the
// backend also requires the CURRENT code, not just the admin role).
export async function resetAdminSecretCode(
  userProfile: UserProfile,
  currentSecretCode: string,
  newSecretCode: string,
): Promise<{ employee_id: string; reset: boolean }> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/admin/reset-secret-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      current_secret_code: currentSecretCode,
      new_secret_code: newSecretCode,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return await response.json();
}

export async function listConversations(userProfile: UserProfile): Promise<ConversationListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/conversations?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as ConversationListResponse;
}

export async function getConversation(
  userProfile: UserProfile,
  conversationId: string,
): Promise<ConversationDetailResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/conversations/${conversationId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as ConversationDetailResponse;
}

// Phase 165 - the "GenAI Chat Workflow History" sidebar section's own
// list/detail calls, same query-param-identity GET shape as
// listConversations/getConversation above but hitting chat_workflow_store's
// own routes.
export async function listAdhocSessions(userProfile: UserProfile): Promise<AdhocSessionListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/adhoc-document-chat/sessions?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdhocSessionListResponse;
}

export async function getAdhocSession(userProfile: UserProfile, sessionId: string): Promise<AdhocSessionDetailResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/adhoc-document-chat/sessions/${sessionId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdhocSessionDetailResponse;
}

export async function deleteConversation(
  userProfile: UserProfile,
  conversationId: string,
): Promise<{ conversation_id: string; turns_deleted: number }> {
  const response = await fetch(`${API_BASE_URL}/v1/conversations/${conversationId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as { conversation_id: string; turns_deleted: number };
}

// Phase 162 - "Request Unpaid Leave", deliberately separate from both the
// GenAI Chat Workflow functions above and its own presigned-upload shape -
// a different S3 bucket, a different backend route family.

export async function getLeaveDocumentUploadUrl(
  userProfile: UserProfile,
  filename: string,
  contentType: string,
): Promise<LeaveDocumentUploadUrlResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, filename, content_type: contentType }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as LeaveDocumentUploadUrlResponse;
}

export async function submitUnpaidLeaveRequest(
  userProfile: UserProfile,
  startDate: string,
  endDate: string,
  purpose: string,
  leaveTypeCode: LeaveTypeCode,
  documentReference?: string,
): Promise<UnpaidLeaveRequestResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      start_date: startDate,
      end_date: endDate,
      purpose,
      leave_type_code: leaveTypeCode,
      document_reference: documentReference,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as UnpaidLeaveRequestResponse;
}

// Phase 165
export async function listMyLeaveRequests(userProfile: UserProfile): Promise<MyLeaveRequestsResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/my-requests?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as MyLeaveRequestsResponse;
}

export async function getLeaveDocumentDownloadUrl(
  userProfile: UserProfile,
  leaveRequestId: number,
): Promise<LeaveDocumentDownloadUrlResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/documents/${leaveRequestId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as LeaveDocumentDownloadUrlResponse;
}

export async function listPendingUnpaidLeaveRequests(userProfile: UserProfile): Promise<PendingHitlRequestsResponse> {
  // Same Phase 96 "identity in query params, not a body" reasoning as every
  // other GET route - but as one JSON blob, matching the backend route's
  // own `user_profile: str` param, not 3 separate employee_id/full_name/role
  // fields the way listDocuments()/listFeedback() do it.
  const response = await fetch(
    `${API_BASE_URL}/v1/unpaid-leave/pending?user_profile=${encodeURIComponent(JSON.stringify(userProfile))}`,
  );

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PendingHitlRequestsResponse;
}

// Phase 168 (round 2) - the HR specialist grid's own data source, every
// status, not just PENDING. Query-param identity as 3 separate fields,
// matching listMyLeaveRequests()/the other newer GET routes.
export async function listAllLeaveRequests(userProfile: UserProfile): Promise<HrLeaveRequestsResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/all?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as HrLeaveRequestsResponse;
}

export async function resolveUnpaidLeaveRequest(
  userProfile: UserProfile,
  hitlRequestContextId: number,
  decision: "APPROVED" | "REJECTED",
  responseText: string,
): Promise<ResolveHitlRequestResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/unpaid-leave/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      hitl_request_context_id: hitlRequestContextId,
      decision,
      response_text: responseText,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as ResolveHitlRequestResponse;
}

// Phase 168 - admin dashboard. Documents reuse listDocuments()/
// deleteDocumentById() above unchanged - the backend route is identical,
// just its RBAC widened to also accept the admin role.
export async function listAllConversationsAdmin(userProfile: UserProfile): Promise<AdminConversationListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/conversations?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminConversationListResponse;
}

export async function getConversationTurnsAdmin(
  userProfile: UserProfile,
  conversationId: string,
): Promise<ConversationDetailResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/conversations/${conversationId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as ConversationDetailResponse;
}

export async function deleteConversationAdmin(
  userProfile: UserProfile,
  conversationId: string,
): Promise<AdminDeleteConversationResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/conversations/${conversationId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDeleteConversationResponse;
}

export async function listAllFeedbackAdmin(userProfile: UserProfile): Promise<FeedbackListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/feedback?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FeedbackListResponse;
}

export async function deleteFeedbackAdmin(
  userProfile: UserProfile,
  feedbackId: number,
): Promise<AdminDeleteFeedbackResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/feedback/${feedbackId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDeleteFeedbackResponse;
}

export async function deleteLeaveRequestAdmin(
  userProfile: UserProfile,
  hitlRequestContextId: number,
): Promise<AdminDeleteLeaveRequestResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/leave-requests/${hitlRequestContextId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDeleteLeaveRequestResponse;
}

// Phase 170 (round 1) - the admin-only docs viewer.

export async function listAdminDocs(userProfile: UserProfile): Promise<AdminDocListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/docs?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDocListResponse;
}

export async function listGoldenDataset(userProfile: UserProfile): Promise<GoldenDatasetListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/golden-dataset?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as GoldenDatasetListResponse;
}

// Phase 1 - real production queries captured when their live groundedness
// score crossed the configurable LTM threshold (or didn't - isLtm filters).
export async function listLiveQueries(userProfile: UserProfile, isLtm?: boolean): Promise<LiveQueryListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  if (isLtm !== undefined) {
    params.set("is_ltm", String(isLtm));
  }
  const response = await fetch(`${API_BASE_URL}/v1/admin/live-queries?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as LiveQueryListResponse;
}

// Phase 7 - hard-delete one captured live query, same DELETE-by-id pattern
// deleteFeedbackAdmin()/deleteLeaveRequestAdmin() already use above.
export async function deleteLiveQuery(
  userProfile: UserProfile,
  liveQueryId: number,
): Promise<AdminDeleteLiveQueryResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/live-queries/${liveQueryId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDeleteLiveQueryResponse;
}

// Phase 9 (hrb_chatbot_service's own Phase 272) - promotes one reviewed
// live query into the Synthetic Dataset. POST, not PUT - this isn't an
// idempotent-in-the-HTTP-sense update of an existing resource, it's an
// action (same reasoning grantDemoWaiver below already uses POST for).
export async function promoteLiveQueryToSynthetic(
  userProfile: UserProfile,
  liveQueryId: number,
): Promise<SyntheticDatasetCaseSummary> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/live-queries/${liveQueryId}/promote-to-synthetic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as SyntheticDatasetCaseSummary;
}

// Phase 2 (hrb_chatbot_service Phase 265) - every tracked live-demo visitor.
export async function listDemoVisitors(userProfile: UserProfile): Promise<DemoVisitorListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/demo-visitors?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as DemoVisitorListResponse;
}

// Phase 2 - adds 15 extra queries to this conversation's effective demo
// limit, repeatable. Body-based identity, not query-param - not a safe/
// idempotent GET, same reasoning updateAppSetting's own PUT already uses.
export async function grantDemoWaiver(userProfile: UserProfile, conversationId: string): Promise<GrantWaiverResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/demo-visitors/${conversationId}/grant-waiver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as GrantWaiverResponse;
}

// Phase 8 - hard-delete one tracked demo visitor, same DELETE-by-id pattern
// deleteFeedbackAdmin()/deleteLiveQuery() already use above, keyed on
// conversation_id instead of a numeric id (this table's real primary key).
export async function deleteDemoVisitor(
  userProfile: UserProfile,
  conversationId: string,
): Promise<AdminDeleteDemoVisitorResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/demo-visitors/${conversationId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDeleteDemoVisitorResponse;
}

// Phase 1 - programmatically generated test cases, distinct from the
// hand-curated golden dataset above.
export async function listSyntheticDataset(userProfile: UserProfile): Promise<SyntheticDatasetListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/synthetic-dataset?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as SyntheticDatasetListResponse;
}

// Phase 1 - a generic runtime setting's current value. 404 means the key
// was never set - caller shows that field's own documented default.
export async function getAppSetting(userProfile: UserProfile, key: string): Promise<AppSettingResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/app-settings/${key}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AppSettingResponse;
}

export async function updateAppSetting(
  userProfile: UserProfile,
  key: string,
  value: number | string | boolean,
): Promise<AppSettingResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/app-settings/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, value }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AppSettingResponse;
}

export async function listEvalRuns(userProfile: UserProfile): Promise<EvalRunListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/eval-runs?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as EvalRunListResponse;
}

export async function getEvalRun(userProfile: UserProfile, runId: number): Promise<EvalRunDetail> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/eval-runs/${runId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as EvalRunDetail;
}

export async function getCiStatus(
  userProfile: UserProfile,
  application?: Application,
  page?: number,
): Promise<CiStatusResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  // Phase 235 - both omitted entirely when not given, so the backend's
  // own defaults (BACKEND, page 1) apply - same as before these existed.
  if (application) {
    params.set("application", application);
  }
  if (page) {
    params.set("page", String(page));
  }
  const response = await fetch(`${API_BASE_URL}/v1/admin/ci-status?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as CiStatusResponse;
}

// Phase 188 - one commit's full pipeline (every workflow file that ran for
// it, stitched together, plus its nearest eval-gate result). sha omitted
// defaults to the most recently run commit.
export async function getPipelineStatus(
  userProfile: UserProfile,
  sha?: string,
  application?: Application,
): Promise<PipelineStatusResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  if (sha) {
    params.set("sha", sha);
  }
  // Phase 233 - omitted entirely when not given, so the backend's own
  // default (BACKEND) applies - same as before this param existed.
  if (application) {
    params.set("application", application);
  }
  const response = await fetch(`${API_BASE_URL}/v1/admin/ci-status/pipeline?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PipelineStatusResponse;
}

export async function listPipelineSnapshots(userProfile: UserProfile): Promise<PipelineSnapshotListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/ci-status/pipeline/history?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PipelineSnapshotListResponse;
}

export async function getPipelineSnapshot(userProfile: UserProfile, snapshotId: number): Promise<PipelineStatusResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/ci-status/pipeline/history/${snapshotId}?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PipelineStatusResponse;
}

export async function getRequestMetrics(userProfile: UserProfile, windowHours = 24): Promise<RequestMetricsResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
    window: String(windowHours),
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/request-metrics?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as RequestMetricsResponse;
}

export async function getAdminDocContent(userProfile: UserProfile, docId: number): Promise<AdminDocContentResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/docs/${docId}/content?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AdminDocContentResponse;
}

// Phase 7 (hrb_api_gateway_service) - /health's shape now differs depending on
// whether API_BASE_URL points at the backend directly (today's production
// default - the Gateway's own Phase 5 cutover hasn't happened yet) or at the
// Gateway (this session's local dev setup): the backend's own /health has
// embedding_model at the top level; the Gateway's /health nests the backend's
// full report under checks.backend_service.backend_report, since the Gateway
// has its own separate Redis/backend-reachability checks at the top level
// too. Reads both shapes rather than assuming one, so this keeps working
// whichever the frontend is pointed at.
interface GatewayHealthResponse {
  checks?: {
    backend_service?: {
      backend_report?: { embedding_model?: string; guardrails_supported_models?: string[] } | null;
    };
  };
}

export async function getHealth(): Promise<{ embedding_model: string; guardrails_supported_models: string[] }> {
  // /health intentionally returns 503 whenever ANY check is unhealthy (e.g.
  // Redis down locally) even when the one check this field actually needs
  // (backend_service) is fine - unlike every other endpoint, a non-2xx
  // here doesn't mean "no data," so this reads the body regardless of
  // status instead of throwing it away via parseErrorAndThrow.
  const response = await fetch(`${API_BASE_URL}/health`);
  const body = (await response.json()) as {
    embedding_model?: string;
    guardrails_supported_models?: string[];
  } & GatewayHealthResponse;
  const embeddingModel = body.embedding_model ?? body.checks?.backend_service?.backend_report?.embedding_model ?? "";
  // Phase 244 - same dual-shape reasoning as embedding_model above.
  const guardrailsSupportedModels =
    body.guardrails_supported_models ?? body.checks?.backend_service?.backend_report?.guardrails_supported_models ?? [];
  return { embedding_model: embeddingModel, guardrails_supported_models: guardrailsSupportedModels };
}

export async function submitFaqQuestion(userProfile: UserProfile, query: string): Promise<FaqSubmissionRecord> {
  const response = await fetch(`${API_BASE_URL}/v1/faq/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, query }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FaqSubmissionRecord;
}

export async function listPublishedFaqs(userProfile: UserProfile): Promise<PublishedFaqListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/faq/published?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as PublishedFaqListResponse;
}

export async function listFaqSubmissions(userProfile: UserProfile): Promise<FaqSubmissionListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/faq-submissions?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FaqSubmissionListResponse;
}

export async function restructureFaqSubmission(userProfile: UserProfile, submissionId: number): Promise<FaqSubmissionRecord> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/faq-submissions/${submissionId}/restructure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FaqSubmissionRecord;
}

export async function reviewFaqSubmission(
  userProfile: UserProfile,
  submissionId: number,
  internalReviewStatus: string,
  finalAnswer: string | null,
  published: boolean,
): Promise<FaqSubmissionRecord> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/faq-submissions/${submissionId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      internal_review_status: internalReviewStatus,
      final_answer: finalAnswer,
      published,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as FaqSubmissionRecord;
}

// Phase 187 - Interview Q&A as real, editable DB rows, filterable by topic.
export async function listInterviewQaCards(userProfile: UserProfile, topic?: string): Promise<InterviewQaListResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  if (topic) {
    params.set("topic", topic);
  }
  const response = await fetch(`${API_BASE_URL}/v1/admin/interview-qa?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as InterviewQaListResponse;
}

export async function createInterviewQaCard(userProfile: UserProfile, fields: InterviewQaCardFields): Promise<InterviewQaCard> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/interview-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, fields }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as InterviewQaCard;
}

export async function updateInterviewQaCard(
  userProfile: UserProfile,
  cardId: number,
  fields: InterviewQaCardFields,
): Promise<InterviewQaCard> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/interview-qa/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, fields }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as InterviewQaCard;
}

export async function deleteInterviewQaCard(userProfile: UserProfile, cardId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/interview-qa/${cardId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
}

// Phase 261 - "AWS Demo" Settings tab.
export async function getAwsDemoStatus(userProfile: UserProfile): Promise<AwsDemoStatusResponse> {
  const params = new URLSearchParams({
    employee_id: userProfile.employee_id,
    full_name: userProfile.full_name,
    role: userProfile.role,
  });
  const response = await fetch(`${API_BASE_URL}/v1/admin/aws-demo/status?${params.toString()}`);

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AwsDemoStatusResponse;
}

export async function resumeAwsDemoServices(
  userProfile: UserProfile,
  serviceNames?: string[],
): Promise<AwsDemoStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/aws-demo/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, service_names: serviceNames ?? null }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AwsDemoStatusResponse;
}

export async function pauseAwsDemoServices(
  userProfile: UserProfile,
  serviceNames?: string[],
): Promise<AwsDemoStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/aws-demo/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_profile: userProfile, service_names: serviceNames ?? null }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AwsDemoStatusResponse;
}
