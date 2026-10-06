import type { DocumentUploadResponse, RagQueryResponse, UserProfile } from "../types";

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
  const response = await fetch(`${API_BASE_URL}/v1/genai-rag/retrieve-document/query`, {
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
