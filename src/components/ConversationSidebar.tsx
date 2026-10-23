import { useState, type ReactNode } from "react";
import type { AdhocSessionSummary, Conversation } from "../types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDelete: (conversationId: string) => void;
  // Phase 165 - the "GenAI Chat Workflow History" section, a separate data
  // source (chat_workflow_store, not conversation_memory) and read-only -
  // no delete action exists for these yet, unlike the section above.
  adhocSessions: AdhocSessionSummary[];
  onSelectAdhocSession: (sessionId: string) => void;
  children?: ReactNode;
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewConversation,
  onDelete,
  adhocSessions,
  onSelectAdhocSession,
  children,
}: ConversationSidebarProps) {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [isAdhocHistoryExpanded, setIsAdhocHistoryExpanded] = useState(true);
  // 2026-10-21 - Settings moved from an inline expand/collapse section
  // (chevron on the right of the row) to a popup modal, user-directed -
  // frees up sidebar height that the 3-tab RAG Search/RAG Config/Model
  // content used to take, same modal-overlay/modal-card pattern already
  // used by ExplainabilityModal.
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  return (
    <aside className="sidebar">
      <button type="button" className="new-conversation-button" onClick={onNewConversation}>
        + New conversation
      </button>

      <section className="sidebar-section sidebar-section-history">
        <button
          type="button"
          className="sidebar-section-header"
          onClick={() => setIsHistoryExpanded((current) => !current)}
          aria-expanded={isHistoryExpanded}
        >
          <span>AI RAG Chat History</span>
          <span className="sidebar-section-chevron">{isHistoryExpanded ? "▾" : "▸"}</span>
        </button>
        {isHistoryExpanded && (
          <ul className="conversation-list">
            {conversations.length === 0 && <li className="conversation-empty">No conversations yet.</li>}
            {conversations.map((conversation) => (
              <li key={conversation.id} className="conversation-row">
                <button
                  type="button"
                  className={
                    conversation.id === activeConversationId ? "conversation-item active" : "conversation-item"
                  }
                  onClick={() => onSelect(conversation.id)}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  className="link-button conversation-delete"
                  title="Delete this conversation"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(conversation.id);
                  }}
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sidebar-section sidebar-section-history">
        <button
          type="button"
          className="sidebar-section-header"
          onClick={() => setIsAdhocHistoryExpanded((current) => !current)}
          aria-expanded={isAdhocHistoryExpanded}
        >
          <span>GenAI Chat Workflow History</span>
          <span className="sidebar-section-chevron">{isAdhocHistoryExpanded ? "▾" : "▸"}</span>
        </button>
        {isAdhocHistoryExpanded && (
          <ul className="conversation-list">
            {adhocSessions.length === 0 && <li className="conversation-empty">No attached-file chats yet.</li>}
            {adhocSessions.map((session) => (
              <li key={session.session_id} className="conversation-row">
                <button
                  type="button"
                  className={
                    session.session_id === activeConversationId ? "conversation-item active" : "conversation-item"
                  }
                  onClick={() => onSelectAdhocSession(session.session_id)}
                >
                  {session.session_title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {children && (
        <section className="sidebar-section sidebar-section-settings">
          <button
            type="button"
            className="sidebar-section-header settings-trigger"
            onClick={() => setIsSettingsModalOpen(true)}
          >
            <span className="settings-gear-icon" aria-hidden="true">
              ⚙
            </span>
            <span>Settings</span>
          </button>
        </section>
      )}

      {isSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="modal-card settings-modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>Settings</h2>
            {children}
            <div className="modal-actions">
              <button type="button" onClick={() => setIsSettingsModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
