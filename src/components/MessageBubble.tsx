import type { ChatMessage, FeedbackVote } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
  onFeedback: (vote: FeedbackVote) => void;
  onExplain: () => void;
}

export default function MessageBubble({ message, onFeedback, onExplain }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={isAssistant ? "message message-assistant" : "message message-user"}>
      <p className="message-text">{message.text}</p>

      {isAssistant && message.sources && message.sources.length > 0 && (
        <p className="message-citations">
          Sources:{" "}
          {message.sources
            .map((source) => `${source.filename}, chunk ${source.chunk_index}`)
            .join("; ")}
        </p>
      )}

      {isAssistant && (
        <div className="message-actions">
          <button
            type="button"
            className={message.feedback === "helpful" ? "link-button active" : "link-button"}
            onClick={() => onFeedback("helpful")}
          >
            Helpful
          </button>
          <button
            type="button"
            className={message.feedback === "not_quite" ? "link-button active" : "link-button"}
            onClick={() => onFeedback("not_quite")}
          >
            Not quite
          </button>
          <button type="button" className="link-button" onClick={onExplain}>
            Explainability
          </button>
        </div>
      )}
    </div>
  );
}
