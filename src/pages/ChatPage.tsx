import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  askAgenticQuery,
  askMultiAgenticQuery,
  askQuery,
  deleteConversation,
  getConversation,
  getHealth,
  listConversations,
  submitFeedback,
  ApiRequestError,
} from "../api/client";
import ConversationSidebar from "../components/ConversationSidebar";
import ExplainabilityModal from "../components/ExplainabilityModal";
import FeedbackModal from "../components/FeedbackModal";
import MessageBubble from "../components/MessageBubble";
import { useIdentity } from "../context/IdentityContext";
import { loadConversations, saveConversations } from "../storage/conversationsStorage";
import type { ChatMessage, ChatMode, Conversation, FeedbackVote, SearchStrategy } from "../types";

const MODE_LABELS: Record<ChatMode, string> = {
  "genai-rag": "GenAI RAG",
  "single-agentic-rag": "Single-Agent RAG",
  "multi-agentic-rag": "Multi-Agent RAG",
};

const SEARCH_STRATEGY_LABELS: Record<SearchStrategy, string> = {
  similarity: "Semantic Search",
  mmr: "MMR",
  keyword: "Keyword",
  hybrid: "Hybrid",
};

const DEFAULT_LAMBDA_MULT = 0.5;

const DEFAULT_TEMPERATURE = 0.0;

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
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [searchStrategy, setSearchStrategy] = useState<SearchStrategy>("similarity");
  const [lambdaMult, setLambdaMult] = useState(DEFAULT_LAMBDA_MULT);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ messageId: string } | null>(null);
  const [explainTarget, setExplainTarget] = useState<ChatMessage | null>(null);
  const [explainQuery, setExplainQuery] = useState<string | null>(null);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!identity) {
      navigate("/login");
      return;
    }
    setConversations(loadConversations(identity.employee_id));

    // Phase 128 - best-effort; Settings panel just shows nothing for this field if it fails.
    getHealth()
      .then((health) => setEmbeddingModel(health.embedding_model))
      .catch(() => {});

    // Phase 116: merge in conversations that exist on the server but not in
    // this browser's own storage (started on a different device/browser) -
    // shown with an empty message list until opened (lazy-loaded below),
    // since the server only stores turn text, not the rich per-message
    // metadata (sources, eval scores) localStorage keeps for this
    // browser's own history.
    listConversations(identity)
      .then((response) => {
        setConversations((current) => {
          const knownIds = new Set(current.map((entry) => entry.id));
          const remoteOnly: Conversation[] = response.conversations
            .filter((summary) => !knownIds.has(summary.conversation_id))
            .map((summary) => ({
              id: summary.conversation_id,
              title: titleFromQuery(summary.title),
              mode: "genai-rag",
              messages: [],
              createdAt: new Date(summary.started_at).getTime(),
            }));
          if (remoteOnly.length === 0) {
            return current;
          }
          return [...current, ...remoteOnly].sort((a, b) => b.createdAt - a.createdAt);
        });
      })
      .catch(() => {
        // Best-effort - the sidebar still works from local storage alone if this fails.
      });
  }, [identity, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversationId, conversations, isSending]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, [draft]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(event.target as Node)) {
        setIsAdminMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!identity) {
    return null;
  }
  const currentIdentity: typeof identity = identity;

  const activeConversation = conversations.find((entry) => entry.id === activeConversationId) ?? null;
  // Pipeline is always the live dropdown selection - switchable mid-conversation.
  // Each message already renders conditionally on which fields it actually
  // has (retrievalInfo vs. tasks/toolsUsed), not on a conversation-wide mode,
  // so mixing pipelines within one conversation's history renders correctly.
  const effectiveMode: ChatMode = selectedMode;

  function persist(nextConversations: Conversation[]) {
    setConversations(nextConversations);
    saveConversations(currentIdentity.employee_id, nextConversations);
  }

  function handleNewConversation() {
    setActiveConversationId(null);
    setDraft("");
    setSendError(null);
  }

  async function handleSelectConversation(conversationId: string) {
    setActiveConversationId(conversationId);

    const existing = conversations.find((entry) => entry.id === conversationId);
    if (!existing || existing.messages.length > 0) {
      return; // already loaded (or created) in this browser - nothing to fetch
    }

    try {
      const detail = await getConversation(currentIdentity, conversationId);
      const messages: ChatMessage[] = detail.turns.map((turn) => ({
        id: makeId(),
        role: turn.role === "human" ? "user" : "assistant",
        text: turn.content,
        createdAt: new Date(turn.created_at).getTime(),
        feedback: null,
      }));
      setConversations((current) => {
        const updated = current.map((entry) => (entry.id === conversationId ? { ...entry, messages } : entry));
        saveConversations(currentIdentity.employee_id, updated);
        return updated;
      });
    } catch {
      // Best-effort - leave it as an empty conversation rather than blocking selection.
    }
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

    const mode = effectiveMode;
    const conversationIdSoFar = activeConversation?.id ?? null;
    // Live state, not frozen at conversation creation - retrieval strategy
    // and temperature can change per turn, same conversation or not.
    const genaiRagOptions = {
      temperature,
      searchStrategy,
      lambdaMult: searchStrategy === "mmr" ? lambdaMult : undefined,
    };

    try {
      let assistantMessage: ChatMessage;
      let returnedConversationId: string | null;

      if (mode === "genai-rag") {
        const response = await askQuery(currentIdentity, query, conversationIdSoFar, genaiRagOptions);
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer_info.answer,
          createdAt: Date.now(),
          sources: response.retrieval_info.sources,
          modelUsed: response.answer_info.model_used,
          feedback: null,
          explainability: response.explainability_info,
          retrievalInfo: response.retrieval_info,
          toolsUsed: response.tools_used,
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
          sources: response.sources,
          iterations: response.iterations,
          feedback: null,
          explainability: response.explainability_info,
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
          sources: response.sources,
          iterations: response.iterations,
          tasks: response.tasks,
          feedback: null,
          explainability: response.explainability_info,
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleOpenFeedback(messageId: string) {
    setFeedbackTarget({ messageId });
  }

  function applyFeedback(vote: FeedbackVote, reasonTags: string[], notes: string) {
    if (!feedbackTarget || !activeConversation) {
      return;
    }

    const messageIndex = activeConversation.messages.findIndex(
      (message) => message.id === feedbackTarget.messageId,
    );
    const answerMessage = messageIndex >= 0 ? activeConversation.messages[messageIndex] : null;
    const questionMessage =
      messageIndex > 0 ? activeConversation.messages[messageIndex - 1] : null;

    if (answerMessage) {
      submitFeedback(
        currentIdentity,
        activeConversation.id,
        feedbackTarget.messageId,
        vote,
        reasonTags,
        notes || null,
        questionMessage?.text ?? "",
        answerMessage.text,
      ).catch((error) => {
        // Feedback is a nice-to-have, not core chat flow - log and move on
        // rather than blocking the UI if the backend call fails.
        console.error("Failed to save feedback:", error);
      });
    }

    const updated = conversations.map((entry) =>
      entry.id === activeConversation.id
        ? {
            ...entry,
            messages: entry.messages.map((message) =>
              message.id === feedbackTarget.messageId ? { ...message, feedback: vote } : message,
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
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
      >
        <div className="tuning-bar">
          <label htmlFor="mode-select">
            RAG Pipeline:
            <select
              id="mode-select"
              value={effectiveMode}
              onChange={(event) => setSelectedMode(event.target.value as ChatMode)}
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {effectiveMode === "genai-rag" && (
          <div className="tuning-bar">
            <label htmlFor="search-strategy-select">
              Retrieval:
              <select
                id="search-strategy-select"
                value={searchStrategy}
                onChange={(event) => setSearchStrategy(event.target.value as SearchStrategy)}
              >
                {Object.entries(SEARCH_STRATEGY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {searchStrategy === "mmr" && (
              <label htmlFor="lambda-mult-input">
                Diversity (lambda):
                <input
                  id="lambda-mult-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={lambdaMult}
                  onChange={(event) => setLambdaMult(Number(event.target.value))}
                  title="1.0 = pure relevance, 0.0 = pure diversity"
                />
              </label>
            )}
            <label htmlFor="temperature-input">
              Temperature:
              <input
                id="temperature-input"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
              />
            </label>
            {embeddingModel && (
              <label>
                Embedding Model:
                <input type="text" value={embeddingModel} readOnly disabled />
              </label>
            )}
            <p className="dev-note-inline">Takes effect on your next message.</p>
          </div>
        )}
      </ConversationSidebar>

      <div className="chat-main">
        <header className="chat-topbar">
          <span>
            {identity.full_name} ({identity.role})
          </span>
          <div className="topbar-actions">
            <div className="admin-menu" ref={adminMenuRef}>
              <button
                type="button"
                className="link-button admin-menu-trigger"
                aria-expanded={isAdminMenuOpen}
                onClick={() => setIsAdminMenuOpen((current) => !current)}
              >
                Admin ▾
              </button>
              {isAdminMenuOpen && (
                <div className="admin-menu-dropdown">
                  {identity.role === "hr_support" && (
                    <Link to="/upload" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Upload documents
                    </Link>
                  )}
                  {identity.role === "hr_support" && (
                    <Link to="/documents" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Manage documents
                    </Link>
                  )}
                  <Link to="/feedback" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                    View feedback
                  </Link>
                </div>
              )}
            </div>
            <button type="button" className="link-button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <div className="message-list">
          <div className="chat-column">
            {(activeConversation?.messages ?? []).map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenFeedback={() => handleOpenFeedback(message.id)}
                onExplain={() => {
                  setExplainTarget(message);
                  const messages = activeConversation?.messages ?? [];
                  const precedingUserMessage = messages
                    .slice(0, index)
                    .reverse()
                    .find((candidate) => candidate.role === "user");
                  setExplainQuery(precedingUserMessage?.text ?? null);
                }}
              />
            ))}
            {isSending && (
              <div className="message message-assistant message-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
            {!activeConversation && <p className="empty-state">Ask a question about HR benefits to start.</p>}
            <div ref={bottomRef} />
          </div>
        </div>

        {sendError && (
          <div className="chat-column">
            <p className="error-banner">{sendError}</p>
          </div>
        )}

        <form className="composer" onSubmit={handleSend}>
          <div className="chat-column composer-row">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask about dental plans, PTO, 401(k)... (Enter to send, Shift+Enter for a new line)"
              rows={2}
              disabled={isSending}
            />
            <button
              type="button"
              className="mic-button"
              title="Audio input (coming soon)"
              aria-label="Audio input (coming soon)"
              onClick={() => window.alert("Audio feature not available yet.")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path
                  d="M5 11a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5z"
                  fillRule="evenodd"
                />
                <rect x="11" y="18" width="2" height="4" />
                <rect x="8" y="21" width="8" height="1.5" rx="0.75" />
              </svg>
            </button>
            <button type="submit" disabled={isSending || !draft.trim()}>
              {isSending ? "Asking..." : "Send"}
            </button>
          </div>
        </form>
      </div>

      {feedbackTarget && <FeedbackModal onClose={() => setFeedbackTarget(null)} onSubmit={applyFeedback} />}

      {explainTarget && (
        <ExplainabilityModal message={explainTarget} originalQuery={explainQuery} onClose={() => setExplainTarget(null)} />
      )}
    </div>
  );
}
