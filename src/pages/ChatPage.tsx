import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  askAdhocDocumentChat,
  askAgenticQuery,
  askAutoRoutedQuery,
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
import HelpPopover from "../components/HelpPopover";
import MessageBubble from "../components/MessageBubble";
import { SettingField } from "../components/SettingsPanel";
import UnpaidLeaveModal from "../components/UnpaidLeaveModal";
import { useIdentity } from "../context/IdentityContext";
import { loadConversations, saveConversations } from "../storage/conversationsStorage";
import type {
  AdhocSessionSummary,
  AgentSearchStrategy,
  ChatMessage,
  ChatMode,
  Conversation,
  FeedbackVote,
  SearchStrategy,
} from "../types";

// 2026-10-21 - "Reflex RAG" renamed to "Direct RAG": frees "Reflex" for
// single-agentic-rag's new "Reflex Agent" label below (user-directed).
// The 2026-10-18 note above invoked the IK FDE course's own "reflex
// agent" term for genai-rag specifically - but with single-agentic-rag
// now also wanting "Reflex" in its name, one word would mean two
// different pipelines. "Direct RAG" names what genai-rag actually is (a
// fixed retrieve-then-generate pass, no agent loop at all) without
// competing for "reflex". multi-agentic-rag becomes "Agentic Workflow"
// (same user direction) - Planner-dispatch-Reviewer is the real
// "workflow" of the three. Internal values stay unchanged ("genai-rag"/
// "single-agentic-rag"/"multi-agentic-rag") - only display labels move.
// Phase 240 - "Auto" added: classifies single- vs multi-agentic-rag per
// question instead of the caller picking. Both forced options stay
// selectable too (demos/interviews - this project's whole purpose).
const MODE_LABELS: Record<ChatMode, string> = {
  "genai-rag": "Direct RAG",
  "single-agentic-rag": "Reflex Agent",
  "multi-agentic-rag": "Agentic Workflow",
  "auto-agentic-rag": "Auto",
};

// Phase 218 - "similarity"'s own label now names its real algorithm (it
// always ran this way; just wasn't spelled out before) and "knn" is a new,
// genuinely different, real option - not a decorative duplicate of it.
// Phase 252 - "dynamic" added first (object order drives dropdown order,
// and it's now the default selection, user-directed).
const SEARCH_STRATEGY_LABELS: Record<SearchStrategy, string> = {
  dynamic: "Dynamic RAG Retrieval",
  similarity: "Semantic Search - ANN (Approximate Nearest Neighbor) via HNSW",
  mmr: "MMR (Maximal Marginal Relevance)",
  keyword: "Keyword",
  hybrid: "Hybrid",
  knn: "Exact KNN (K-Nearest Neighbors, brute-force)",
};

// Phase 228 - Single/Multi-Agent RAG only understand these 2 (their
// shared tool, search_knowledge_base(), only ever resolves to one of
// these 2 - see endpoint-request-response-contracts.md's Phase 228
// entry) - a real subset, not every SEARCH_STRATEGY_LABELS option.
const AGENT_SEARCH_STRATEGY_LABELS: Record<AgentSearchStrategy, string> = {
  similarity: SEARCH_STRATEGY_LABELS.similarity,
  mmr: SEARCH_STRATEGY_LABELS.mmr,
};

// Phase 175 - admin-only doc links. RAG Pipeline resolves to a different
// doc per dropdown option; Retrieval shares one doc across all 4 search
// strategies - no per-method doc exists yet (flagged directly to the user,
// not silently assumed).
const MODE_DOC_FEATURE: Record<ChatMode, string> = {
  "genai-rag": "genai-rag-chat",
  "single-agentic-rag": "single-agentic-rag",
  "multi-agentic-rag": "multi-agentic-rag",
  "auto-agentic-rag": "auto-agentic-rag",
};
const RETRIEVAL_DOC_FEATURE = "retrieval-strategies";

// Phase 153 - concise, one entry per retrieval strategy, shown in the "?" popover below the dropdown.
// Phase 218 - similarity/knn now also name which backends they actually
// run against, after re-investigating a user-reported "is this real?"
// question: both ChromaDB and Pinecone support both, with a real cost
// difference (noted below), not a feature gap on either side.
const SEARCH_STRATEGY_HELP: Record<SearchStrategy, string> = {
  dynamic:
    "Picks the right retrieval technique for you, per question, automatically - no setup needed. Short/acronym-heavy questions lean Keyword, broad 'tell me about' questions lean MMR, questions mixing specific terms with natural language lean Hybrid, everything else uses Semantic Search. The retrieval technique that actually ran is always shown in Explainability.",
  similarity:
    "Ranks chunks by meaning-based relevance to your question (vector similarity), via each backend's own approximate index (HNSW). Fast - best for most questions, but can return several chunks covering the same point if the knowledge base repeats it, and HNSW's approximation can occasionally miss the true closest match. Supported identically by ChromaDB and Pinecone - this is what both already run internally, always.",
  mmr: "Also ranks by relevance (same HNSW-backed search as Semantic Search), but actively avoids picking chunks too similar to ones already chosen - trades a little pure relevance for broader topic coverage. The Diversity (lambda) slider controls the balance: 1.0 = pure relevance, 0.0 = pure diversity.",
  keyword:
    "Ranks by exact word/acronym overlap (BM25), not meaning. Best when your question uses specific terms, codes, or acronyms a meaning-based search might miss.",
  hybrid:
    "Combines Keyword and Semantic Search results into one ranked list. Usually the most robust choice - catches both exact-term and meaning-based matches - at the cost of running both searches.",
  knn: "Computes real cosine similarity against every current chunk directly - no index, no approximation, so it can never miss a true closest match the way HNSW occasionally can. Slower: it's a full read of the knowledge base every query, not an indexed lookup. Supported by both ChromaDB and Pinecone, but the cost differs - ChromaDB reads its whole collection locally (fast); Pinecone has no bulk-export call, so this walks its whole index in paginated batches (noticeably slower on a large knowledge base, same cost profile Hybrid/Keyword search already accept on Pinecone today).",
};

const DEFAULT_LAMBDA_MULT = 0.5;

const DEFAULT_TEMPERATURE = 0.0;

// Phase 216 - mirror hrb_chatbot_v2's real .env values (RAG_DEFAULT_TOP_K,
// OPENAI_CHAT_MODEL) exactly, not guessed - same convention as
// DEFAULT_TEMPERATURE/ADHOC_MAX_FILES above. Will drift if that .env
// changes and this isn't updated alongside it - no endpoint exposes these
// today for the frontend to read live instead.
const DEFAULT_TOP_K = 5;
const DEFAULT_JUDGE_MODEL = "gpt-4.1-mini";
// 2026-10-21 - DeepEval isn't integrated in the backend (only comment
// mentions exist, no real library/pipeline wiring) - this field is UI-only
// for now, not sent on any request, per explicit user decision. Kept
// separate from llmJudgeModel (the real, wired field) rather than merged,
// so the distinction stays visible once DeepEval is actually built.
const DEFAULT_DEEPEVAL_MODEL = "";
// Phase 243 - mirrors hrb_chatbot_v2's real OPENAI_DECOMPOSE_MODEL/
// OPENAI_PLANNER_MODEL .env defaults, same "mirror the real value, don't
// guess" convention as DEFAULT_JUDGE_MODEL above.
// 2026-10-23 HOTFIX: was "gpt-4.1-nano" - OpenAI shut that model down
// today. Since these fields are always sent as an explicit per-request
// override (never empty, see decomposeModel/plannerModel below), this
// silently broke query decomposition and Planner routing on every real
// request from this website - found live via a Playwright test driving
// the real UI, invisible to direct API testing since a raw request with
// no override never hits this path at all.
const DEFAULT_DECOMPOSE_MODEL = "gpt-4.1-mini";
const DEFAULT_PLANNER_MODEL = "gpt-4.1-mini";

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
  // is active (both conditions, not one replacing the other). 2026-10-18 -
  // default flipped to off (was on) - user-directed.
  const [adhocChatEnabled, setAdhocChatEnabled] = useState(false);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  // Phase 252 - default changed from "similarity" to "dynamic", user-directed.
  const [searchStrategy, setSearchStrategy] = useState<SearchStrategy>("dynamic");
  const [lambdaMult, setLambdaMult] = useState(DEFAULT_LAMBDA_MULT);
  // Phase 228 - separate state from searchStrategy above, deliberately:
  // different value domain (2 options, not 5) and different request field
  // (a per-mode default agentSearchStrategy, not genai-rag's own
  // searchStrategy) - picking "hybrid" in Reflex RAG must never leak into
  // what Single/Multi-Agent RAG send, and vice versa.
  const [agentSearchStrategy, setAgentSearchStrategy] = useState<AgentSearchStrategy>("similarity");
  // Phase 216 - Settings restructured into 3 tabs (RAG Search/RAG Config/
  // Model), user-directed. Initial values mirror the backend's own real
  // runtime defaults (RAG_DEFAULT_TOP_K/OPENAI_CHAT_MODEL in
  // hrb_chatbot_v2's .env, same mirroring convention ADHOC_MAX_FILES
  // above already uses) - not invented numbers. evalScoreThreshold has no
  // real backend default to mirror: Phase 215 deliberately shipped it
  // opt-in only (no threshold enforced unless the caller sets one), so it
  // stays unset/off here too rather than inventing one.
  // 2026-10-29 - Memory/Resiliency added (user-directed): moved here from
  // the Admin Dashboard's own now-removed "Settings" top-level category
  // (Phase 4/5 there) - these are app-wide runtime knobs, same family as
  // this bar's existing Model tab, not Build & Deployment content. Both
  // new tabs are admin-only (see the tab-row buttons and their panels
  // below) - the knobs they hold (DeepEval judge provider was folded into
  // the existing Model tab instead of a 4th tab, since it's genuinely a
  // model-selection setting) aren't meant for every role to see or edit.
  const [settingsTab, setSettingsTab] = useState<
    "rag-search" | "rag-config" | "model" | "memory" | "resiliency"
  >("rag-search");
  const [topK, setTopK] = useState<number | undefined>(DEFAULT_TOP_K);
  const [evalScoreThreshold, setEvalScoreThreshold] = useState<number | undefined>(undefined);
  // Phase 226 - off by default, same reasoning as evalScoreThreshold above
  // (opt-in only, no backend default to mirror) - also a no-op without a
  // threshold set, enforced backend-side.
  const [enableCorrectiveRetry, setEnableCorrectiveRetry] = useState(false);
  const [llmJudgeModel, setLlmJudgeModel] = useState(DEFAULT_JUDGE_MODEL);
  // Phase 243 - decomposeModel is genai-rag only, plannerModel is
  // multi-agentic-rag only (classification_options.decompose_model/
  // planner_model - never both on the same request, see client.ts).
  const [decomposeModel, setDecomposeModel] = useState(DEFAULT_DECOMPOSE_MODEL);
  const [plannerModel, setPlannerModel] = useState(DEFAULT_PLANNER_MODEL);
  // UI-only - not sent on any request, see DEFAULT_DEEPEVAL_MODEL above.
  const [deepEvalModel, setDeepEvalModel] = useState(DEFAULT_DEEPEVAL_MODEL);
  // Phase 244 - real, wired override, shared across all 3 modes. "" means
  // "use the backend's own default" (not sent at all, see client.ts) -
  // never a value the backend would reject, since the <select> is built
  // entirely from guardrailsSupportedModels below, fetched from GET /health.
  const [guardrailsModel, setGuardrailsModel] = useState("");
  const [guardrailsSupportedModels, setGuardrailsSupportedModels] = useState<string[]>([]);
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
  // checkbox - not a persistent toggle. Separate from the GenAI Chat
  // Workflow's own attach-files popup above. 2026-10-19 - this comment
  // used to say "deliberately mode-independent", which Phase 164 (below,
  // at the render site) reversed to mode-gated - left stale here until
  // now, corrected to point at the render site's own up-to-date history
  // instead of repeating the now-false claim.
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
    // Phase 244 - guardrails_supported_models populates the Guardrails Model
    // dropdown too, same fetch, same best-effort failure handling.
    getHealth()
      .then((health) => {
        setEmbeddingModel(health.embedding_model);
        setGuardrailsSupportedModels(health.guardrails_supported_models);
      })
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
      topK,
      judgeModel: llmJudgeModel || undefined,
      evalScoreThreshold,
      enableCorrectiveRetry,
      decomposeModel: decomposeModel || undefined,
      guardrailsModel: guardrailsModel || undefined,
    };
    // Judge model / eval threshold apply uniformly across all 3 pipelines
    // (Phase 215) - genai-rag gets them via genaiRagOptions above, the
    // other 2 modes via this smaller, shared shape. Phase 228 -
    // agentSearchStrategy likewise only means anything for these 2 modes.
    // Phase 244 - guardrailsModel too, genuinely shared (unlike plannerModel).
    const evalOptions = {
      judgeModel: llmJudgeModel || undefined,
      evalScoreThreshold,
      agentSearchStrategy,
      plannerModel: plannerModel || undefined,
      guardrailsModel: guardrailsModel || undefined,
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
          evalScoreThreshold,
          enableCorrectiveRetry,
          demoLimit: response.demo_limit,
        };
        returnedConversationId = response.conversation_id;
      } else if (mode === "single-agentic-rag") {
        const response = await askAgenticQuery(currentIdentity, query, conversationIdSoFar, evalOptions);
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
          evalScoreThreshold,
          demoLimit: response.demo_limit,
        };
        returnedConversationId = response.conversation_id;
      } else if (mode === "multi-agentic-rag") {
        const response = await askMultiAgenticQuery(currentIdentity, query, conversationIdSoFar, evalOptions);
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
          evalScoreThreshold,
          demoLimit: response.demo_limit,
        };
        returnedConversationId = response.conversation_id;
      } else {
        // Phase 240 - "Auto": response is whichever shape the resolved
        // pipeline actually returned, discriminated by its own resolved_mode
        // field ("tasks" only exists on the multi-agentic-rag shape).
        const response = await askAutoRoutedQuery(currentIdentity, query, conversationIdSoFar, evalOptions);
        const wasMulti = "tasks" in response;
        assistantMessage = {
          id: makeId(),
          role: "assistant",
          text: response.answer,
          createdAt: Date.now(),
          toolsUsed: response.tools_used,
          sources: response.sources,
          iterations: response.iterations,
          tasks: wasMulti ? response.tasks : undefined,
          resolvedMode: response.resolved_mode ?? undefined,
          feedback: null,
          explainability: response.explainability_info,
          evalScoreThreshold,
          demoLimit: response.demo_limit,
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
        {/* Phase 216 - Settings reorganized into 3 tabs (user-directed):
            RAG Search (pipeline mode + retrieval strategy), RAG Config
            (temperature/top K/eval score threshold), Model (embedding
            model + LLM judge model). Replaces the single flat "tuning-bar"
            these used to share. */}
        <div className="tuning-bar settings-tabs-bar">
          <div className="settings-tab-row">
            <button
              type="button"
              className={settingsTab === "rag-search" ? "settings-tab-active" : "settings-tab"}
              onClick={() => setSettingsTab("rag-search")}
            >
              RAG Search
            </button>
            <button
              type="button"
              className={settingsTab === "rag-config" ? "settings-tab-active" : "settings-tab"}
              onClick={() => setSettingsTab("rag-config")}
            >
              RAG Config
            </button>
            <button
              type="button"
              className={settingsTab === "model" ? "settings-tab-active" : "settings-tab"}
              onClick={() => setSettingsTab("model")}
            >
              Model
            </button>
            {/* 2026-10-29 - admin-only (user-directed): these moved from the
                Admin Dashboard's own DevOps-only "Settings" category, so
                they keep the same access restriction here, not widened to
                every role just because the tab moved. */}
            {currentIdentity.role === "admin" && (
              <>
                <button
                  type="button"
                  className={settingsTab === "memory" ? "settings-tab-active" : "settings-tab"}
                  onClick={() => setSettingsTab("memory")}
                >
                  Memory
                </button>
                <button
                  type="button"
                  className={settingsTab === "resiliency" ? "settings-tab-active" : "settings-tab"}
                  onClick={() => setSettingsTab("resiliency")}
                >
                  Resiliency
                </button>
              </>
            )}
          </div>

          {settingsTab === "rag-search" && (
            <div className="settings-tab-panel">
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

              {/* 2026-10-19 (Phase 228) - Retrieval Strategy now shown for
                  all 3 modes, user-directed. Reflex RAG gets the full
                  6-option list (genai-rag's own `search_strategy` field,
                  "dynamic" added Phase 252 and made the default);
                  Single/Multi-Agent RAG get a real but NARROWER 2-option
                  list bound to a separate state (agentSearchStrategy) and
                  a different request field - their shared tool
                  (search_knowledge_base()) only ever understands
                  similarity/mmr, confirmed in code, not guessed - showing
                  the other 3 there would silently no-op, the exact
                  "decorative control" bug this project avoids elsewhere.
                  Still hidden for the GenAI Chat Workflow's own attach-
                  files path - that skips the vector store entirely, real
                  search strategy to configure there at all. */}
              {effectiveMode === "genai-rag" && !adhocChatEnabled && (
                <>
                  <label htmlFor="search-strategy-select">
                    <span className="tuning-label-row">
                      Retrieval Strategy:
                      <DocLink featureName={RETRIEVAL_DOC_FEATURE} />
                      <HelpPopover label="What do these retrieval strategies mean?">
                        {Object.entries(SEARCH_STRATEGY_LABELS).map(([value, label]) => (
                          <p key={value}>
                            <strong>{label}:</strong> {SEARCH_STRATEGY_HELP[value as SearchStrategy]}
                          </p>
                        ))}
                      </HelpPopover>
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
                </>
              )}
              {(effectiveMode === "single-agentic-rag" ||
                effectiveMode === "multi-agentic-rag" ||
                effectiveMode === "auto-agentic-rag") && (
                <label htmlFor="agent-search-strategy-select">
                  <span className="tuning-label-row">
                    Retrieval Strategy:
                    <HelpPopover label="What does Retrieval Strategy do in this mode?">
                      {effectiveMode === "single-agentic-rag" ? (
                        <p>
                          This is a DEFAULT, not a forced setting - the AI already chooses its own search method
                          per search when it has a reason to (e.g. picking MMR for a broad question). This only
                          applies when the AI doesn't make its own choice.
                        </p>
                      ) : effectiveMode === "multi-agentic-rag" ? (
                        <p>
                          Unlike Single-Agent RAG, there's no AI choice involved here - this mode always uses
                          whatever you pick here, every time it searches.
                        </p>
                      ) : (
                        <p>
                          Auto picks Reflex Agent or Agentic Workflow per question - this setting applies to
                          whichever one it resolves to, same behavior each mode's own help text above describes.
                        </p>
                      )}
                      {Object.entries(AGENT_SEARCH_STRATEGY_LABELS).map(([value, label]) => (
                        <p key={value}>
                          <strong>{label}:</strong> {SEARCH_STRATEGY_HELP[value as AgentSearchStrategy]}
                        </p>
                      ))}
                    </HelpPopover>
                  </span>
                  <select
                    id="agent-search-strategy-select"
                    value={agentSearchStrategy}
                    onChange={(event) => setAgentSearchStrategy(event.target.value as AgentSearchStrategy)}
                  >
                    {Object.entries(AGENT_SEARCH_STRATEGY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {effectiveMode === "genai-rag" && adhocChatEnabled && (
                <p className="dev-note-inline">
                  No Retrieval Strategy setting here - the GenAI Chat Workflow answers only from the files you
                  attach, not the knowledge base, so no search happens at all.
                </p>
              )}
            </div>
          )}

          {settingsTab === "rag-config" && (
            <div className="settings-tab-panel">
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
              <label htmlFor="top-k-input">
                Top K:
                <input
                  id="top-k-input"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  placeholder="default"
                  value={topK ?? ""}
                  onChange={(event) => setTopK(event.target.value === "" ? undefined : Number(event.target.value))}
                  title="How many chunks to retrieve. Leave blank to use the backend's own default."
                />
              </label>
              <label htmlFor="eval-score-threshold-input">
                Eval Score Threshold:
                <input
                  id="eval-score-threshold-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  placeholder="off"
                  value={evalScoreThreshold ?? ""}
                  onChange={(event) =>
                    setEvalScoreThreshold(event.target.value === "" ? undefined : Number(event.target.value))
                  }
                  title="Flags an answer whose groundedness/completeness/retrieval precision falls below this value. Leave blank to turn this check off."
                />
              </label>
              {/* Phase 226 - genai-rag only, same reasoning as Retrieval
                  Strategy above (AgenticRagRequest/MultiAgenticRagRequest
                  have no search_options field at all to carry this on) -
                  hidden rather than shown-but-inert for the other 2 modes. */}
              {effectiveMode === "genai-rag" && (
                <div className="checkbox-row-with-help">
                  <label htmlFor="corrective-retry-checkbox" className="checkbox-label">
                    <input
                      id="corrective-retry-checkbox"
                      type="checkbox"
                      checked={enableCorrectiveRetry}
                      onChange={(event) => setEnableCorrectiveRetry(event.target.checked)}
                    />
                    Retry Once on Low Retrieval Score
                  </label>
                  <HelpPopover label="What does Retry Once on Low Retrieval Score do?">
                    <p>
                      Requires Eval Score Threshold above to be set - without a threshold there's nothing to
                      compare against, so this does nothing.
                    </p>
                    <p>
                      When on: right after the system searches your documents, it quickly checks how good those
                      results look. If they look weak (below your threshold), it searches again with a wider net
                      (more chunks) ONE time before generating the answer - never more than once, to keep cost
                      and wait time predictable.
                    </p>
                  </HelpPopover>
                </div>
              )}
            </div>
          )}

          {settingsTab === "model" && (
            <div className="settings-tab-panel">
              {/* 2026-10-21 - both rows read the same real value (OPENAI_EMBED_MODEL,
                  via getHealth().embedding_model) - genuinely one configured model,
                  not two. Shown as two rows anyway, same reasoning as the DeepEval/
                  LLM-as-Judge split above: the two USE CASES are distinct (chunking
                  a document at ingestion time vs. embedding the live query at search
                  time) even though no override exists for either independently - a
                  RAG retriever requires both to share one embedding space, so there's
                  no real "different model per stage" option to expose here. */}
              {embeddingModel && (
                <>
                  <label>
                    Embedding Model (Document Chunks → Vectors):
                    <input
                      type="text"
                      value={embeddingModel}
                      readOnly
                      disabled
                      title="Embeds each document chunk into a vector at ingestion time. Same configured model as Embedding Model (Query Embedding) below - a RAG retriever needs both in the same embedding space."
                    />
                  </label>
                  <label>
                    Embedding Model (Query Embedding):
                    <input
                      type="text"
                      value={embeddingModel}
                      readOnly
                      disabled
                      title="Embeds your question into a vector before similarity search. Same configured model as Embedding Model (Document Chunks → Vectors) above, for the same reason."
                    />
                  </label>
                </>
              )}
              <label htmlFor="llm-judge-model-input">
                LLM as Judge Model:
                <input
                  id="llm-judge-model-input"
                  type="text"
                  placeholder="default"
                  value={llmJudgeModel}
                  onChange={(event) => setLlmJudgeModel(event.target.value)}
                  title="Which model scores groundedness/completeness/retrieval precision. Leave blank to use the backend's own default judge model."
                />
              </label>
              <label htmlFor="deepeval-model-input">
                DeepEval Model:
                <input
                  id="deepeval-model-input"
                  type="text"
                  placeholder="not yet wired up"
                  value={deepEvalModel}
                  onChange={(event) => setDeepEvalModel(event.target.value)}
                  title="DeepEval isn't integrated in the backend yet - this field isn't sent on any request. Shown here as a placeholder until real DeepEval scoring exists."
                />
              </label>
              {/* Phase 243 - model tiering: cheap-tier models for the
                  classification-only steps (query decomposition, agentic
                  routing), each shown only for the mode that actually has
                  that step - AgenticRagRequest (single-agentic-rag) has
                  no classification_options field at all to carry either on. */}
              {effectiveMode === "genai-rag" && (
                <label htmlFor="decompose-model-input">
                  Query Decomposition Model:
                  <input
                    id="decompose-model-input"
                    type="text"
                    placeholder="default"
                    value={decomposeModel}
                    onChange={(event) => setDecomposeModel(event.target.value)}
                    title="Which model splits a compound question into sub-questions before retrieval. Leave blank to use the backend's own default (gpt-4.1-mini)."
                  />
                </label>
              )}
              {effectiveMode === "multi-agentic-rag" && (
                <label htmlFor="planner-model-input">
                  RAG Model:
                  <input
                    id="planner-model-input"
                    type="text"
                    placeholder="default"
                    value={plannerModel}
                    onChange={(event) => setPlannerModel(event.target.value)}
                    title="Which model the Planner Agent uses to route your question to the right sub-agent(s). Label-only - this is still Planner-only; Reviewer and the ReAct loop stay on the full model, unchanged (confirmed 2026-10-21). Leave blank to use the backend's own default (gpt-4.1-mini)."
                  />
                </label>
              )}
              {/* Phase 244 - real, wired override (reversed Phase 243's
                  "out of scope" call, user-directed). Dropdown, not free
                  text - options come entirely from guardrailsSupportedModels
                  (GET /health), so nothing the backend would 422 on can be
                  selected. Empty option = use the backend's own default. */}
              <label htmlFor="guardrails-model-select">
                Guardrails Model:
                <select
                  id="guardrails-model-select"
                  value={guardrailsModel}
                  onChange={(event) => setGuardrailsModel(event.target.value)}
                  title="Which model runs input/output safety checks. Leave as default to use the backend's own configured model."
                >
                  <option value="">default</option>
                  {guardrailsSupportedModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              {/* 2026-10-29 - moved here from the Admin Dashboard's removed
                  "Settings" category (its own former Model sub-tab) -
                  genuinely a model-selection setting, same as every other
                  field on this tab, so folded in rather than given its own
                  tab. Admin-only, matching that tab's prior access. */}
              {currentIdentity.role === "admin" && (
                <SettingField
                  userProfile={currentIdentity}
                  settingKey="judge_provider_default"
                  label="DeepEval judge provider"
                  helpText="Which LLM provider scores golden/release-gate cases (groundedness, completeness, relevancy, etc)."
                  kind="select"
                  options={[
                    { value: "openai", label: "OpenAI" },
                    { value: "anthropic", label: "Anthropic" },
                  ]}
                />
              )}
            </div>
          )}

          {/* 2026-10-29 - moved from the Admin Dashboard's removed
              "Settings" category (its own former Memory/Resiliency
              sub-tabs) - see the tab-row buttons above for the admin-only
              gating these 2 tabs carry over unchanged. */}
          {settingsTab === "memory" && currentIdentity.role === "admin" && (
            <div className="settings-tab-panel">
              <SettingField
                userProfile={currentIdentity}
                settingKey="ltm_score_threshold"
                label="LTM score threshold"
                helpText={
                  "Live queries scoring at or above this groundedness threshold (0.0-1.0) get promoted to " +
                  "is_ltm = true - a curated pool of real-world questions the system already answers well. " +
                  "This is distinct from the existing conversation_store, which saves every turn regardless of score."
                }
                kind="number"
                min={0}
                max={1}
                step={0.05}
              />
            </div>
          )}

          {settingsTab === "resiliency" && currentIdentity.role === "admin" && (
            <div className="settings-tab-panel">
              <SettingField
                userProfile={currentIdentity}
                settingKey="react_loop_max_iterations"
                label="ReAct loop max iterations"
                helpText="single-agentic-rag's own tool-calling loop cap, per request."
                kind="number"
                min={1}
                step={1}
              />
              <SettingField
                userProfile={currentIdentity}
                settingKey="llm_openai_circuit_breaker_failure_threshold"
                label="OpenAI circuit breaker - failure threshold"
                helpText="Consecutive OpenAI call failures, within the cooldown window below, before the breaker trips."
                kind="number"
                min={1}
                step={1}
              />
              <SettingField
                userProfile={currentIdentity}
                settingKey="llm_openai_circuit_breaker_cooldown_seconds"
                label="OpenAI circuit breaker - cooldown seconds"
                helpText="How long the breaker stays open (failing fast) once tripped, before allowing one retry."
                kind="number"
                min={1}
                step={1}
              />
              <SettingField
                userProfile={currentIdentity}
                settingKey="llm_anthropic_circuit_breaker_failure_threshold"
                label="Anthropic circuit breaker - failure threshold"
                helpText="Consecutive Anthropic call failures, within the cooldown window below, before the breaker trips."
                kind="number"
                min={1}
                step={1}
              />
              <SettingField
                userProfile={currentIdentity}
                settingKey="llm_anthropic_circuit_breaker_cooldown_seconds"
                label="Anthropic circuit breaker - cooldown seconds"
                helpText="How long the breaker stays open (failing fast) once tripped, before allowing one retry."
                kind="number"
                min={1}
                step={1}
              />
            </div>
          )}
        </div>

        {/* 2026-10-21 - user-directed: Request Unpaid Leave moved out of
            Settings entirely, to a persistent icon button on the left edge
            of the composer (see composer-row below) - it's a standalone
            leave-request workflow, not a RAG retrieval setting, and its
            placement here previously needed its own layout-shift
            workarounds (the "reserve the slot" history this comment used
            to describe) precisely because it didn't really belong in this
            tab. Same mode/role gating carried over unchanged: Multi-Agent
            RAG only, hidden for hr_support. */}

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
        {/* 2026-10-19 - same "reserve the slot, don't remove it" fix as
            the Request Unpaid Leave block above - this checkbox also used
            to vanish from the DOM entirely outside genai-rag mode,
            another real contributor to Settings' overall height changing
            on every RAG Pipeline switch. 2026-10-19 round 2 - also now
            scoped to the RAG Search tab only, same reasoning as the
            Request Unpaid Leave block above (was visible on every
            Settings tab, not just the one it topically belongs to). */}
        {settingsTab === "rag-search" && (
          <div className="tuning-bar unpaid-leave-slot">
          {effectiveMode === "genai-rag" && (
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
              <HelpPopover label="What is the GenAI Chat Workflow?">
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
              </HelpPopover>
            </div>
          )}
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
                      anyway, matching the backend's own ADMIN-only gate.
                      2026-10-19 - one exception restored: Build &
                      Deployment gets its own direct link again
                      (user-requested), to a genuinely separate route
                      (/deployments, standaloneCategory="build-deploy" -
                      not a ?tab= deep-link into the shared dashboard,
                      which still showed every other category's own
                      picker) - admin-only, matching DEVOPS_ONLY_CATEGORIES'
                      own existing restriction (employee_admin never saw
                      this category either way). */}
                  {identity.role === "admin" && (
                    <Link to="/deployments" className="admin-menu-item" onClick={() => setIsAdminMenuOpen(false)}>
                      Build &amp; Deployment
                    </Link>
                  )}
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

        {/* Phase 2 (hrb_chatbot_service Phase 265) - proactive remaining-
            queries indicator, from the most recent assistant message's own
            demo_limit. Null for admin/hr_support (exempt) or when the
            limiter is disabled server-side - renders nothing then. */}
        {!sendError &&
          (() => {
            const messages = activeConversation?.messages ?? [];
            const lastAssistantMessage = messages.filter((message) => message.role === "assistant").at(-1);
            const demoLimit = lastAssistantMessage?.demoLimit;
            if (!demoLimit) {
              return null;
            }
            return (
              <div className="chat-column">
                <p className="dev-note-inline">
                  {demoLimit.remaining} of {demoLimit.effective_limit} demo questions remaining in this session.
                </p>
              </div>
            );
          })()}

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
            {/* 2026-10-21 - moved here from Settings -> RAG Search (user-
                directed) - a persistent icon button on the left edge of the
                composer, instead of a checkbox buried in a settings tab.
                Same gating carried over unchanged: Multi-Agent RAG only,
                hidden for hr_support (HR specialists use the separate
                "Leave approvals" view instead - Admin menu). */}
            {effectiveMode === "multi-agentic-rag" && currentIdentity.role !== "hr_support" && (
              <button
                type="button"
                className="mic-button"
                title="Request Unpaid Leave, Critical CareGiver Leave, Short-Term Disability, or Long-Term Disability - routed to a human HR specialist to review."
                aria-label="Request Unpaid Leave"
                onClick={() => setShowUnpaidLeaveModal(true)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
            )}
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
