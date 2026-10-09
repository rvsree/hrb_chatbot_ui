import { useState, type ReactNode } from "react";
import type { Conversation } from "../types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDelete: (conversationId: string) => void;
  children?: ReactNode;
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewConversation,
  onDelete,
  children,
}: ConversationSidebarProps) {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);

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
          <span>Conversation history</span>
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

      {children && (
        <section className="sidebar-section sidebar-section-settings">
          <button
            type="button"
            className="sidebar-section-header"
            onClick={() => setIsSettingsExpanded((current) => !current)}
            aria-expanded={isSettingsExpanded}
          >
            <span>Settings</span>
            <span className="sidebar-section-chevron">{isSettingsExpanded ? "▾" : "▸"}</span>
          </button>
          {isSettingsExpanded && <div className="sidebar-section-body">{children}</div>}
        </section>
      )}
    </aside>
  );
}
