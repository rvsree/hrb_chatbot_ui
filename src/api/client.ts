import type {
  AgenticRagResponse,
  DocumentListResponse,
  DocumentUploadResponse,
  MultiAgenticRagResponse,
  RagQueryResponse,
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

async function parseErrorAndThrow(response: Response): Promise<never> {
  let message = `Request failed with status ${response.status}`;
  let code = "UNKNOWN_ERROR";
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") {
      message = body.error;
    }
    if (body && typeof body.code === "string") {
      code = body.code;
    }
  } catch {
    // Response wasn't JSON - keep the generic message/code above.
  }
  throw new ApiRequestError(message, code, response.status);
}

export async function askQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
): Promise<RagQueryResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
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
): Promise<AgenticRagResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/single-agentic-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
    }),
  });

  if (!response.ok) {
    await parseErrorAndThrow(response);
  }
  return (await response.json()) as AgenticRagResponse;
}

export async function askMultiAgenticQuery(
  userProfile: UserProfile,
  query: string,
  conversationId: string | null,
): Promise<MultiAgenticRagResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/multi-agentic-rag-retrieval/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_profile: userProfile,
      query,
      enable_conversation_memory: true,
      conversation_id: conversationId,
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
): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  formData.append("payload", JSON.stringify({ user_profile: userProfile }));

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
