import type { Conversation } from "../types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDelete: (conversationId: string) => void;
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewConversation,
  onDelete,
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
          <li key={conversation.id} className="conversation-row">
            <button
              type="button"
              className={conversation.id === activeConversationId ? "conversation-item active" : "conversation-item"}
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
    </aside>
  );
}
