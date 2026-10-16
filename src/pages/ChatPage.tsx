import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  askAdhocDocumentChat,
  askAgenticQuery,
  askMultiAgenticQuery,
  askQuery,
  deleteConversation,
  getAdhocSession,
  getConversation,
  getHealth,
  listAdhocSessions,
  listConversations,
  submitFeedback,
  ApiRequestError,
} from "../api/client";
import ConfirmModal from "../components/ConfirmModal";
import ConversationSidebar from "../components/ConversationSidebar";
import DocLink from "../components/DocLink";
import ExplainabilityModal from "../components/ExplainabilityModal";
import FeedbackModal from "../components/FeedbackModal";
import MessageBubble from "../components/MessageBubble";
import UnpaidLeaveModal from "../components/UnpaidLeaveModal";
import { useIdentity } from "../context/IdentityContext";
import { loadConversations, saveConversations } from "../storage/conversationsStorage";
import type { AdhocSessionSummary, ChatMessage, ChatMode, Conversation, FeedbackVote, SearchStrategy } from "../types";

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

// Phase 175 - admin-only doc links. RAG Pipeline resolves to a different
// doc per dropdown option; Retrieval shares one doc across all 4 search
// strategies - no per-method doc exists yet (flagged directly to the user,
// not silently assumed).
const MODE_DOC_FEATURE: Record<ChatMode, string> = {
  "genai-rag": "genai-rag-chat",
  "single-agentic-rag": "single-agentic-rag",
  "multi-agentic-rag": "multi-agentic-rag",
};
const RETRIEVAL_DOC_FEATURE = "retrieval-strategies";

// Phase 153 - concise, one entry per retrieval strategy, shown in the "?" popover below the dropdown.
const SEARCH_STRATEGY_HELP: Record<SearchStrategy, string> = {
  similarity:
    "Ranks chunks by meaning-based relevance to your question (vector similarity). Fast, and the default - best for most questions, but can return several chunks covering the same point if the knowledge base repeats it.",
  mmr: "Also ranks by relevance, but actively avoids picking chunks too similar to ones already chosen - trades a little pure relevance for broader topic coverage. The Diversity (lambda) slider controls the balance: 1.0 = pure relevance, 0.0 = pure diversity.",
  keyword:
    "Ranks by exact word/acronym overlap (BM25), not meaning. Best when your question uses specific terms, codes, or acronyms a meaning-based search might miss.",
  hybrid:
    "Combines Keyword and Semantic Search results into one ranked list. Usually the most robust choice - catches both exact-term and meaning-based matches - at the cost of running both searches.",
};

const DEFAULT_LAMBDA_MULT = 0.5;

const DEFAULT_TEMPERATURE = 0.0;

// Phase 136 backend: MAX_FILES=3, ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES=10MB
// (models/adhoc_chat.py) - mirrored here exactly, not guessed.
const ADHOC_MAX_FILES = 3;
const ADHOC_ALLOWED_EXTENSIONS = [".pdf", ".docx", ".csv"];
const ADHOC_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface AdhocFileRejection {
  filename: string;
  reason: string;
}

function isAdhocFileAllowed(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return ADHOC_ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function validateAndMergeAdhocFiles(
  existing: File[],
  incoming: File[],
): { accepted: File[]; rejections: AdhocFileRejection[] } {
  const accepted = [...existing];
  const rejections: AdhocFileRejection[] = [];

  for (const file of incoming) {
    if (accepted.length >= ADHOC_MAX_FILES) {
      rejections.push({ filename: file.name, reason: `At most ${ADHOC_MAX_FILES} files are allowed.` });
      continue;
    }
    if (!isAdhocFileAllowed(file)) {
      rejections.push({ filename: file.name, reason: "Only .pdf, .docx, .csv files are accepted." });
      continue;
    }
    if (file.size > ADHOC_MAX_FILE_SIZE_BYTES) {
      rejections.push({ filename: file.name, reason: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB - the limit is 10MB.` });
      continue;
    }
    const alreadyAdded = accepted.some((entry) => entry.name === file.name && entry.size === file.size);
    if (!alreadyAdded) {
      accepted.push(file);
    }
  }

  return { accepted, rejections };
}

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
  // Phase 165 - summaries for the sidebar's "GenAI Chat Workflow History"
  // section. Separate from `conversations` (that array still holds the
  // actual loaded messages, for both kinds of history - see
  // isAdhocWorkflow) because these summaries come from chat_workflow_store,
  // not conversation_memory, and aren't cached in localStorage the way
  // `conversations` is.
  const [adhocSessions, setAdhocSessions] = useState<AdhocSessionSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Phase 143: replaces window.confirm() for conversation delete - same
  // reported "browser warning" look as the document-delete confirms.
  const [deleteConversationTarget, setDeleteConversationTarget] = useState<string | null>(null);
  // Phase 157 - user-directed default, was "genai-rag".
  const [selectedMode, setSelectedMode] = useState<ChatMode>("multi-agentic-rag");
  // Phase 141: a separate on/off switch for the ad-hoc document chat
  // feature itself, independent of which RAG Pipeline mode is selected -
  // the attach control only shows when this is checked AND GenAI RAG mode
  // is active (both conditions, not one replacing the other).
  const [adhocChatEnabled, setAdhocChatEnabled] = useState(true);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [searchStrategy, setSearchStrategy] = useState<SearchStrategy>("similarity");
  const [lambdaMult, setLambdaMult] = useState(DEFAULT_LAMBDA_MULT);
  const [showRetrievalHelp, setShowRetrievalHelp] = useState(false);
  const [showUnpaidLeaveHelp, setShowUnpaidLeaveHelp] = useState(false);
  const [showAdhocChatHelp, setShowAdhocChatHelp] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ messageId: string } | null>(null);
  const [explainTarget, setExplainTarget] = useState<ChatMessage | null>(null);
  const [explainQuery, setExplainQuery] = useState<string | null>(null);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [adhocFiles, setAdhocFiles] = useState<File[]>([]);
  const [adhocRejections, setAdhocRejections] = useState<AdhocFileRejection[]>([]);
  const [adhocRecipientEmail, setAdhocRecipientEmail] = useState("");
  // Phase 163 - "send email on answer" is independent of the model's own
  // in-text SendEmailWithAnswer decision (Phase 161) - a route-level
  // trigger the checkbox_auto path fires regardless of question wording.
  const [adhocSendEmailOnAnswer, setAdhocSendEmailOnAnswer] = useState(false);
  const [adhocCcEmail, setAdhocCcEmail] = useState("");
  const [adhocEmailError, setAdhocEmailError] = useState<string | null>(null);
  // Phase 163 - this chat workflow's own memory session id, echoed back by
  // the backend on every adhoc turn and reused on the next one so the
  // model sees chat_history; reset whenever attached files are cleared.
  const [adhocSessionId, setAdhocSessionId] = useState<string | null>(null);
  // Phase 162 - "Request Unpaid Leave": a checkbox that opens its own popup
  // and always reverts to unchecked, same as a trigger button styled as a
  // checkbox - not a persistent toggle. Deliberately mode-independent and
  // separate from the GenAI Chat Workflow's own attach-files popup above.
  const [showUnpaidLeaveModal, setShowUnpaidLeaveModal] = useState(false);
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

    // Phase 165 - the "GenAI Chat Workflow History" section's own list,
    // always server-fetched (chat_workflow_store has no localStorage
    // cache the way `conversations` does).
    listAdhocSessions(identity)
      .then((response) => setAdhocSessions(response.sessions))
      .catch(() => {
        // Best-effort - that sidebar section just stays empty if this fails.
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

  async function handleSelectAdhocSession(sessionId: string) {
    setActiveConversationId(sessionId);

    const existing = conversations.find((entry) => entry.id === sessionId);
    if (existing && existing.messages.length > 0) {
      return; // already loaded (or created this browser session) - nothing to fetch
    }

    try {
      const detail = await getAdhocSession(currentIdentity, sessionId);
      const messages: ChatMessage[] = detail.turns.map((turn) => ({
        id: makeId(),
        role: turn.role === "human" ? "user" : "assistant",
        text: turn.content,
        createdAt: new Date(turn.created_at).getTime(),
        feedback: null,
      }));
      const summary = adhocSessions.find((session) => session.session_id === sessionId);
      setConversations((current) => {
        const alreadyPresent = current.some((entry) => entry.id === sessionId);
        const updated = alreadyPresent
          ? current.map((entry) => (entry.id === sessionId ? { ...entry, messages } : entry))
          : [
              {
                id: sessionId,
                title: titleFromQuery(summary?.session_title ?? "GenAI Chat Workflow"),
                mode: "genai-rag" as ChatMode,
                messages,
                createdAt: summary ? new Date(summary.started_at).getTime() : Date.now(),
                isAdhocWorkflow: true,
              },
              ...current,
            ];
        saveConversations(currentIdentity.employee_id, updated);
        return updated;
      });
    } catch {
      // Best-effort - leave it as an empty conversation rather than blocking selection.
    }
  }

  function handleDeleteConversation(conversationId: string) {
    setDeleteConversationTarget(conversationId);
  }

  async function handleConfirmDeleteConversation() {
    const conversationId = deleteConversationTarget;
    setDeleteConversationTarget(null);
    if (!conversationId) {
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

  function handleAdhocFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const { accepted, rejections } = validateAndMergeAdhocFiles(adhocFiles, Array.from(event.target.files ?? []));
    setAdhocFiles(accepted);
    setAdhocRejections(rejections);
    event.target.value = "";
  }

  function removeAdhocFile(fileToRemove: File) {
    setAdhocFiles((current) => current.filter((file) => file !== fileToRemove));
  }

  function clearAdhocFiles() {
    setAdhocFiles([]);
    setAdhocRejections([]);
    setAdhocRecipientEmail("");
    setAdhocSendEmailOnAnswer(false);
    setAdhocCcEmail("");
    setAdhocEmailError(null);
    setAdhocSessionId(null);
  }

  const ADHOC_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function isValidEmailList(value: string): boolean {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .every((entry) => ADHOC_EMAIL_PATTERN.test(entry));
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || isSending) {
      return;
    }

    if (adhocFiles.length > 0 && adhocSendEmailOnAnswer) {
      if (!adhocRecipientEmail || !ADHOC_EMAIL_PATTERN.test(adhocRecipientEmail)) {
        setAdhocEmailError("Enter a valid recipient email to send the answer on send.");
        return;
      }
      if (adhocCcEmail && !isValidEmailList(adhocCcEmail)) {
        setAdhocEmailError("One of the CC addresses doesn't look like a valid email.");
        return;
      }
    }
    setAdhocEmailError(null);

    setIsSending(true);
    setSendError(null);

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      text: query,
      createdAt: Date.now(),
    };

    const mode = effectiveMode;
    const isAdhocTurn = adhocFiles.length > 0;
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

      if (adhocFiles.length > 0) {
        // Chat GenAI Workflow (Phase 136) - files attached directly in the
        // composer bypass the mode-based branching below entirely. Stays
        // labeled "GenAI RAG" in the dropdown on purpose - attaching a
        // file is what switches the actual call, not a new mode choice.
        const response = await askAdhocDocumentChat(currentIdentity, query, adhocFiles, adhocRecipientEmail || undefined, {
          sessionId: adhocSessionId ?? undefined,
          sendEmailOnAnswer: adhocSendEmailOnAnswer,
          ccEmail: adhocCcEmail || undefined,
        });
        setAdhocSessionId(response.session_id);
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer,
          createdAt: Date.now(),
          modelUsed: response.model_used,
          feedback: null,
          adhoc: {
            filesUsed: response.files_used,
            webSearches: response.web_searches,
            emailSentTo: response.email_sent_to,
            emailEvidence: response.email_evidence,
            llmCallCount: response.llm_call_count,
            iterations: response.iterations,
            tokenUsage: response.token_usage,
            totalMs: response.latency_ms.total,
          },
        };
        // Phase 165 - was hardcoded null; now the real session_id, so a
        // brand-new adhoc conversation's local id matches the id
        // chat_workflow_store/listAdhocSessions() will later report it
        // under, instead of a random local-only id the 2 never reconcile.
        returnedConversationId = response.session_id;
      } else if (mode === "genai-rag") {
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
          isAdhocWorkflow: isAdhocTurn,
        };
        persist([newConversation, ...conversations]);
        setActiveConversationId(newConversation.id);
      }

      // Phase 165 - keep the sidebar's "GenAI Chat Workflow History"
      // section in sync with this turn immediately, rather than only on
      // the next page load's listAdhocSessions() fetch.
      if (isAdhocTurn) {
        setAdhocSessions((current) => {
          const existingIndex = current.findIndex((session) => session.session_id === conversationId);
          if (existingIndex === -1) {
            return [
              {
                session_id: conversationId,
                session_title: titleFromQuery(query),
                started_at: new Date().toISOString(),
                last_active: new Date().toISOString(),
                turn_count_total: 1,
              },
              ...current,
            ];
          }
          const updated = [...current];
          updated[existingIndex] = {
            ...updated[existingIndex],
            last_active: new Date().toISOString(),
            turn_count_total: updated[existingIndex].turn_count_total + 1,
          };
          return updated;
        });
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
        conversations={conversations.filter((entry) => !entry.isAdhocWorkflow)}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
        adhocSessions={adhocSessions}
        onSelectAdhocSession={handleSelectAdhocSession}
      >
        <div className="tuning-bar">
          <label htmlFor="mode-select">
            <span className="tuning-label-row">
              RAG Pipeline:
              <DocLink featureName={MODE_DOC_FEATURE[effectiveMode]} />
            </span>
            <select
              id="mode-select"
              value={effectiveMode}
              onChange={(event) => {
                setSelectedMode(event.target.value as ChatMode);
                // Phase 140: the attach control only shows in GenAI RAG mode
                // (see composer below) - clear any already-attached files so
                // they don't linger, hidden, attached to a mode that can't use them.
                clearAdhocFiles();
              }}
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Phase 164 - user-directed: gated to Multi-Agent RAG mode only
            (reverses Phase 162's original "deliberately mode-independent"
            choice). Round-2 follow-up: also gated to employee/manager only
            - HR specialists get their own separate "Leave approvals" view
            instead (Admin menu) and must never see or use this submission
            entry point, confirmed live-tested as a real gap (an hr_support
            persona could submit a request through here before this fix).
            Still a separate entry point from the GenAI Chat Workflow's own
            attach-files popup below - always unchecked at rest; checking
            it just opens the popup. */}
        {effectiveMode === "multi-agentic-rag" && currentIdentity.role !== "hr_support" && (
          <div className="tuning-bar">
            <div className="checkbox-row-with-help">
              <label htmlFor="unpaid-leave-trigger-checkbox" className="checkbox-label">
                <input
                  id="unpaid-leave-trigger-checkbox"
                  type="checkbox"
                  checked={showUnpaidLeaveModal}
                  onChange={() => setShowUnpaidLeaveModal(true)}
                />
                Request Unpaid Leave
              </label>
              <DocLink featureName="request-unpaid-leave" />
              <button
                type="button"
                className="chunking-help-button"
                aria-label="What is Request Unpaid Leave?"
                title="What is Request Unpaid Leave?"
                onClick={(event) => {
                  event.preventDefault();
                  setShowUnpaidLeaveHelp((current) => !current);
                }}
              >
                ?
              </button>
            </div>
            {showUnpaidLeaveHelp && (
              <div className="chunking-help-popover">
                <p>
                  Request Unpaid Leave, Critical CareGiver Leave, Short-Term Disability, or Long-Term Disability -
                  for example, extended medical leave or a personal emergency. Fill in the dates and purpose, and
                  optionally attach supporting documentation.
                </p>
                <p>
                  Behind the scenes: the system first checks your leave history for the last 12 months for that
                  same leave type. Every request - first-time or repeat - is then routed to a human HR specialist
                  to review and approve or reject (a "human-in-the-loop" step) - the model never approves leave on
                  its own. Once a specialist has reviewed it, you'll see the outcome (and get an email) - or check
                  "My requests" any time.
                </p>
              </div>
            )}
            <Link to="/my-leave-requests" className="link-button">
              My requests
            </Link>
          </div>
        )}

        {/* Phase 144: fixes a real misread from Phase 142's own follow-up
            instruction. "this control" in that feedback meant the
            checkbox specifically (it's named right before that phrase) -
            not the whole settings block. Only the checkbox is genai-rag-
            only (ad-hoc chat doesn't exist in single/multi-agentic-rag at
            all); Retrieval/Temperature/Embedding Model render
            unconditionally in every mode now, full stop - no hiding, no
            disabling, no explanatory note. This was the user's original,
            repeated, and consistent request since Phase 141 - Phase 142
            wrongly reversed it instead of just dropping the note text. */}
        {effectiveMode === "genai-rag" && (
          <div className="tuning-bar">
            <div className="checkbox-row-with-help">
              <label htmlFor="adhoc-chat-enabled-checkbox" className="checkbox-label">
                <input
                  id="adhoc-chat-enabled-checkbox"
                  type="checkbox"
                  checked={adhocChatEnabled}
                  onChange={(event) => {
                    setAdhocChatEnabled(event.target.checked);
                    // Mirrors the mode-switch cleanup above - don't leave files
                    // attached, hidden, to a feature that's now turned off.
                    if (!event.target.checked) {
                      clearAdhocFiles();
                    }
                  }}
                />
                Enable GenAI Chat Workflow (attach files to ask about directly)
              </label>
              <DocLink featureName="genai-chat-workflow" />
              <button
                type="button"
                className="chunking-help-button"
                aria-label="What is the GenAI Chat Workflow?"
                title="What is the GenAI Chat Workflow?"
                onClick={(event) => {
                  event.preventDefault();
                  setShowAdhocChatHelp((current) => !current);
                }}
              >
                ?
              </button>
            </div>
            {showAdhocChatHelp && (
              <div className="chunking-help-popover">
                <p>
                  Attach your own file (a PDF, Word doc, or CSV - an offer letter, a policy document) and ask
                  about it directly, instead of searching the HR knowledge base. The answer is based only on
                  what's in the file you attached.
                </p>
                <p>
                  Behind the scenes: this skips retrieval from the vector database entirely and reads your file
                  straight into the model's context. It can also search the web for related information and, if
                  you ask, email the answer - and it remembers earlier turns in the same attached-file
                  conversation.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Phase 164 - user-directed: hidden specifically when the GenAI
            Chat Workflow's attach-files feature is turned on (none of these
            settings apply to that path - it never touches the vector
            store). Scoped to the adhocChatEnabled checkbox, not RAG
            Pipeline mode - Phase 144's own "render unconditionally in
            every mode" decision above is about mode, untouched here. */}
        {!(effectiveMode === "genai-rag" && adhocChatEnabled) && (
        <div className="tuning-bar">
          <label htmlFor="search-strategy-select">
            <span className="tuning-label-row">
              Retrieval:
              <DocLink featureName={RETRIEVAL_DOC_FEATURE} />
              <button
                type="button"
                className="chunking-help-button"
                aria-label="What do these retrieval strategies mean?"
                title="What do these retrieval strategies mean?"
                onClick={(event) => {
                  event.preventDefault();
                  setShowRetrievalHelp((current) => !current);
                }}
              >
                ?
              </button>
            </span>
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
          {showRetrievalHelp && (
            <div className="chunking-help-popover">
              {Object.entries(SEARCH_STRATEGY_LABELS).map(([value, label]) => (
                <p key={value}>
                  <strong>{label}:</strong> {SEARCH_STRATEGY_HELP[value as SearchStrategy]}
                </p>
              ))}
            </div>
          )}
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
            <Link to="/faq" className="link-button">
              FAQs
            </Link>
            <div className="admin-menu" ref={adminMenuRef}>
              <button
                type="button"
                className="link-button admin-menu-trigger"
                aria-expanded={isAdminMenuOpen}
                onClick={() => setIsAdminMenuOpen((current) => !current)}
              >
                {/* 2026-10-15 - the trigger label itself now names which of
                    the two admin tiers you are, instead of one generic
                    "Admin" label both shared - the menu contents below
                    differ by tier too (Architecture Docs/Golden Dataset
                    shortcuts are DevOps-only). 2026-10-16 - renamed
                    Engineering Admin -> DevOps, Employee Admin -> Admin
                    (display label only - the underlying Role enum values
                    "admin"/"employee_admin" are unchanged). */}
                {identity.role === "admin" ? "DevOps ▾" : identity.role === "employee_admin" ? "Admin ▾" : "Admin ▾"}
              </button>
              {isAdminMenuOpen && (
                <div className="admin-menu-dropdown">
                  {/* Phase 176 - visibility widened from hr_support-only to also
                      include admin, matching Phase 168's own backend RBAC
                      (ingest_document.py already accepts ADMIN). Phase 178 -
                      the per-item DocLink moved off this menu entirely (it
                      lives on each destination page's own <h1> instead,
                      next to "Document upload"/"Indexed documents") - a
                      live screenshot showed "No doc synced for this feature
                      yet." wrapping badly in this dropdown's narrow width,
                      and the same link here was redundant with the one on
                      the page it leads to. */}
                  <div className="admin-menu-section-label">HR Operations</div>
                  {(identity.role === "hr_support" || identity.role === "admin" || identity.role === "employee_admin") && (
                    <Link to="/upload" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Upload documents
                    </Link>
                  )}
                  {(identity.role === "hr_support" || identity.role === "admin" || identity.role === "employee_admin") && (
                    <Link to="/documents" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Manage documents
                    </Link>
                  )}
                  {/* Phase 178 - widened to admin: a superuser role should
                      reach every feature, including HR Support's own.
                      2026-10-15 - employee_admin too, same reasoning. */}
                  {(identity.role === "hr_support" || identity.role === "admin" || identity.role === "employee_admin") && (
                    <Link to="/leave-approvals" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Leave approvals
                    </Link>
                  )}
                  {(identity.role === "hr_support" || identity.role === "admin" || identity.role === "employee_admin") && (
                    <Link to="/faq-review" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      FAQ submissions
                    </Link>
                  )}
                  {(identity.role === "admin" || identity.role === "employee_admin") && (
                    <Link to="/admin" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Admin dashboard
                    </Link>
                  )}
                  {/* Phase 191 - the DevOps-only deep-links that used to
                      live here (Golden dataset/Eval runs/CI-CD Pipeline/
                      Live metrics/Architecture docs/Interview FAQs/
                      Interview Q&A) are gone - "Admin dashboard" above
                      already opens on the right category/tab via its own
                      ?tab= resolution, and the dashboard's own category +
                      sub-tab bar replaces what this dropdown used to
                      enumerate. Admin (employee_admin) never saw these
                      anyway, matching the backend's own ADMIN-only gate. */}
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

        {(adhocFiles.length > 0 || adhocRejections.length > 0) && (
          <div className="chat-column">
            {/* Phase 139: collapsed by default - a full file list + email field
                was crowding the response area directly above it. Same
                <details>/<summary> pattern as ExplainabilityModal's
                CollapsibleSection, reusing its CSS classes for visual
                consistency rather than a new component. */}
            <details className="explainability-section adhoc-panel">
              <summary>
                {adhocFiles.length > 0
                  ? `Attached: ${adhocFiles.length} file(s) - answered only from these, not the HR knowledge base`
                  : `${adhocRejections.length} file(s) rejected`}
              </summary>
              <div className="explainability-section-body">
                {adhocFiles.length > 0 && (
                  <>
                    <ul className="file-queue">
                      {adhocFiles.map((file) => (
                        <li key={`${file.name}-${file.size}`}>
                          {file.name}
                          <button type="button" className="link-button" onClick={() => removeAdhocFile(file)}>
                            remove
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="adhoc-email-label">
                      Email the answer to (optional):{" "}
                      <input
                        type="email"
                        value={adhocRecipientEmail}
                        onChange={(event) => setAdhocRecipientEmail(event.target.value)}
                        placeholder="someone@example.com"
                      />
                    </label>
                    {/* Phase 163 - route-level trigger, independent of the
                        model's own in-text email decision above. Off by
                        default; checking it requires a valid recipient. */}
                    <label className="adhoc-email-label adhoc-checkbox-label">
                      <input
                        type="checkbox"
                        checked={adhocSendEmailOnAnswer}
                        onChange={(event) => setAdhocSendEmailOnAnswer(event.target.checked)}
                      />
                      Always send email on this answer
                    </label>
                    {adhocSendEmailOnAnswer && (
                      <label className="adhoc-email-label">
                        CC (optional, comma-separated):{" "}
                        <input
                          type="text"
                          value={adhocCcEmail}
                          onChange={(event) => setAdhocCcEmail(event.target.value)}
                          placeholder="someone@example.com, other@example.com"
                        />
                      </label>
                    )}
                    {adhocEmailError && <p className="leave-form-error">{adhocEmailError}</p>}
                    <button type="button" className="link-button" onClick={clearAdhocFiles}>
                      clear attached files
                    </button>
                  </>
                )}
                {adhocRejections.length > 0 && (
                  <ul className="file-queue">
                    {adhocRejections.map((rejection, index) => (
                      <li key={`${rejection.filename}-${index}`} className="status-rejected">
                        <strong>{rejection.filename}</strong>: {rejection.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
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
            {/* Phase 140/141: ad-hoc document chat only ever wires to GenAI
                RAG mode - hide the control entirely rather than let a user
                attach a file while a mode that can't use it is selected.
                Phase 141 adds a second, independent gate: the "Enable
                GenAI Chat Workflow" checkbox above. Both must be true. */}
            {selectedMode === "genai-rag" && adhocChatEnabled && (
              <label className="mic-button" title="Attach up to 3 files (.pdf/.docx/.csv) to ask about them directly" aria-label="Attach files">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.48" />
                </svg>
                <input
                  type="file"
                  accept=".pdf,.docx,.csv"
                  multiple
                  hidden
                  onChange={handleAdhocFileSelect}
                  disabled={isSending}
                />
              </label>
            )}
            <button
              type="button"
              className="mic-button"
              title="Audio input (coming soon)"
              aria-label="Audio input (coming soon)"
              onClick={() => window.alert("Audio feature not available yet.")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            </button>
            <button type="submit" disabled={isSending || !draft.trim()}>
              {isSending ? "Asking..." : "Send"}
            </button>
          </div>
        </form>
      </div>

      {showUnpaidLeaveModal && <UnpaidLeaveModal onClose={() => setShowUnpaidLeaveModal(false)} />}

      {feedbackTarget && <FeedbackModal onClose={() => setFeedbackTarget(null)} onSubmit={applyFeedback} />}

      {explainTarget && (
        <ExplainabilityModal message={explainTarget} originalQuery={explainQuery} onClose={() => setExplainTarget(null)} />
      )}

      {deleteConversationTarget && (
        <ConfirmModal
          title="Delete conversation"
          message="Delete this conversation? This can't be undone."
          onConfirm={handleConfirmDeleteConversation}
          onCancel={() => setDeleteConversationTarget(null)}
        />
      )}
    </div>
  );
}
