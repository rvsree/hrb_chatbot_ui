import type { Conversation } from "../types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewConversation,
}: ConversationSidebarProps) {
  return (
    <aside className="sidebar">
      <button type="button" className="new-conversation-button" onClick={onNewConversation}>
        + New conversation
      </button>

      <p className="dev-note sidebar-note">
        Stored in this browser only - the backend has no conversation-list endpoint yet.
      </p>

      <ul className="conversation-list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className={conversation.id === activeConversationId ? "conversation-item active" : "conversation-item"}
              onClick={() => onSelect(conversation.id)}
            >
              {conversation.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
