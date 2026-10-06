import type { Conversation } from "../types";

// The backend has no GET endpoint for conversation history yet (only
// DELETE - see BACKLOG.md's Phase 95 entry), so conversation history is
// browser-only: one browser, one device, lost on clear. Scoped per
// employee_id so switching identities doesn't mix histories.

function storageKey(employeeId: string) {
  return `hrb_chatbot_conversations_${employeeId}`;
}

export function loadConversations(employeeId: string): Conversation[] {
  try {
    const raw = localStorage.getItem(storageKey(employeeId));
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversations(employeeId: string, conversations: Conversation[]) {
  try {
    localStorage.setItem(storageKey(employeeId), JSON.stringify(conversations));
  } catch {
    // Best effort only - browser storage can throw or be unavailable.
  }
}
