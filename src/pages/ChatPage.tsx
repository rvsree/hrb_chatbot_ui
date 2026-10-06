import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { askAgenticQuery, askMultiAgenticQuery, askQuery, deleteConversation, ApiRequestError } from "../api/client";
import ConversationSidebar from "../components/ConversationSidebar";
import ExplainabilityModal from "../components/ExplainabilityModal";
import FeedbackModal from "../components/FeedbackModal";
import MessageBubble from "../components/MessageBubble";
import { useIdentity } from "../context/IdentityContext";
import { loadConversations, saveConversations } from "../storage/conversationsStorage";
import type { ChatMessage, ChatMode, Conversation, FeedbackVote } from "../types";

const MODE_LABELS: Record<ChatMode, string> = {
  "genai-rag": "GenAI RAG (recommended)",
  "single-agentic-rag": "Single-agent (tool-calling)",
  "multi-agentic-rag": "Multi-agent (planner + domain agents)",
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function titleFromQuery(query: string): string {
  return query.length > 40 ? `${query.slice(0, 40)}...` : query;
}

export default function ChatPage() {
  const { identity, logout } = useIdentity();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ChatMode>("genai-rag");
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ messageId: string; vote: FeedbackVote } | null>(null);
  const [explainTarget, setExplainTarget] = useState<ChatMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!identity) {
      navigate("/login");
      return;
    }
    setConversations(loadConversations(identity.employee_id));
  }, [identity, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversationId, conversations]);

  if (!identity) {
    return null;
  }
  const currentIdentity: typeof identity = identity;

  const activeConversation = conversations.find((entry) => entry.id === activeConversationId) ?? null;

  function persist(nextConversations: Conversation[]) {
    setConversations(nextConversations);
    saveConversations(currentIdentity.employee_id, nextConversations);
  }

  function handleNewConversation() {
    setActiveConversationId(null);
    setDraft("");
    setSendError(null);
  }

  async function handleDeleteConversation(conversationId: string) {
    if (!window.confirm("Delete this conversation? This can't be undone.")) {
      return;
    }
    try {
      // Scoped server-side to the caller's own employee_id - see
      // api/conversations/manage_conversations.py's delete_conversation().
      await deleteConversation(currentIdentity, conversationId);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSendError(`Couldn't delete that conversation: ${error.message} (${error.code})`);
      } else {
        setSendError("Couldn't delete that conversation - something went wrong reaching the backend.");
      }
      return;
    }

    const remaining = conversations.filter((entry) => entry.id !== conversationId);
    persist(remaining);
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || isSending) {
      return;
    }

    setIsSending(true);
    setSendError(null);

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      text: query,
      createdAt: Date.now(),
    };

    const mode = activeConversation?.mode ?? selectedMode;
    const conversationIdSoFar = activeConversation?.id ?? null;

    try {
      let assistantMessage: ChatMessage;
      let returnedConversationId: string | null;

      if (mode === "genai-rag") {
        const response = await askQuery(currentIdentity, query, conversationIdSoFar);
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer_info.answer,
          createdAt: Date.now(),
          sources: response.retrieval_info.sources,
          modelUsed: response.answer_info.model_used,
          feedback: null,
        };
        returnedConversationId = response.conversation_id;
      } else if (mode === "single-agentic-rag") {
        const response = await askAgenticQuery(currentIdentity, query, conversationIdSoFar);
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer,
          createdAt: Date.now(),
          toolsUsed: response.tools_used,
          iterations: response.iterations,
          feedback: null,
        };
        returnedConversationId = response.conversation_id;
      } else {
        const response = await askMultiAgenticQuery(currentIdentity, query, conversationIdSoFar);
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer,
          createdAt: Date.now(),
          toolsUsed: response.tools_used,
          iterations: response.iterations,
          tasks: response.tasks,
          feedback: null,
        };
        returnedConversationId = response.conversation_id;
      }

      const conversationId = returnedConversationId ?? conversationIdSoFar ?? makeId();

      if (activeConversation) {
        const updated = conversations.map((entry) =>
          entry.id === activeConversation.id
            ? { ...entry, messages: [...entry.messages, userMessage, assistantMessage] }
            : entry,
        );
        persist(updated);
      } else {
        const newConversation: Conversation = {
          id: conversationId,
          title: titleFromQuery(query),
          mode,
          messages: [userMessage, assistantMessage],
          createdAt: Date.now(),
        };
        persist([newConversation, ...conversations]);
        setActiveConversationId(newConversation.id);
      }

      setDraft("");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSendError(`${error.message} (${error.code})`);
      } else {
        setSendError("Something went wrong reaching the backend.");
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleFeedbackVote(messageId: string, vote: FeedbackVote) {
    setFeedbackTarget({ messageId, vote });
  }

  function applyFeedback(reasonTags: string[], notes: string) {
    if (!feedbackTarget || !activeConversation) {
      return;
    }
    // No backend endpoint exists yet to send this to (see BACKLOG.md) -
    // recorded locally only, logged to the console so it isn't silently lost.
    console.info("Feedback (not yet sent to backend):", {
      conversationId: activeConversation.id,
      messageId: feedbackTarget.messageId,
      vote: feedbackTarget.vote,
      reasonTags,
      notes,
    });

    const updated = conversations.map((entry) =>
      entry.id === activeConversation.id
        ? {
            ...entry,
            messages: entry.messages.map((message) =>
              message.id === feedbackTarget.messageId ? { ...message, feedback: feedbackTarget.vote } : message,
            ),
          }
        : entry,
    );
    persist(updated);
    setFeedbackTarget(null);
  }

  return (
    <div className="chat-layout">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={setActiveConversationId}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="chat-main">
        <header className="chat-topbar">
          <span>
            {identity.full_name} ({identity.role})
            {activeConversation && <span className="mode-indicator"> · {MODE_LABELS[activeConversation.mode]}</span>}
          </span>
          <div className="topbar-actions">
            {identity.role === "hr_support" && <Link to="/upload">Upload documents</Link>}
            {identity.role === "hr_support" && <Link to="/documents">Manage documents</Link>}
            <button type="button" className="link-button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <div className="message-list">
          {(activeConversation?.messages ?? []).map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onFeedback={(vote) => handleFeedbackVote(message.id, vote)}
              onExplain={() => setExplainTarget(message)}
            />
          ))}
          {!activeConversation && (
            <div className="empty-state">
              <p>Ask a question about HR benefits to start.</p>
              <label htmlFor="mode-select" className="mode-select-label">
                Pipeline for this conversation:
              </label>
              <select
                id="mode-select"
                value={selectedMode}
                onChange={(event) => setSelectedMode(event.target.value as ChatMode)}
              >
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {selectedMode === "multi-agentic-rag" && (
                <p className="dev-note">
                  This pipeline errors server-side when conversation memory is on (a real
                  backend bug, not fixed here - see BACKLOG.md), so each question here is
                  answered independently, without context from earlier turns.
                </p>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {sendError && <p className="error-banner">{sendError}</p>}

        <form className="composer" onSubmit={handleSend}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about dental plans, PTO, 401(k)..."
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || !draft.trim()}>
            {isSending ? "Asking..." : "Send"}
          </button>
        </form>
      </div>

      {feedbackTarget && (
        <FeedbackModal
          vote={feedbackTarget.vote}
          onClose={() => setFeedbackTarget(null)}
          onSubmit={applyFeedback}
        />
      )}

      {explainTarget && <ExplainabilityModal message={explainTarget} onClose={() => setExplainTarget(null)} />}
    </div>
  );
}
