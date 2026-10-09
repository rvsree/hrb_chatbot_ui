import ThumbIcon from "./ThumbIcon";
import { parseMessageIntoSegments } from "../utils/markdownTable";
import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
  onOpenFeedback: () => void;
  onExplain: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MessageBubble({ message, onOpenFeedback, onExplain }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  const segments = isAssistant ? parseMessageIntoSegments(message.text) : null;

  return (
    <div className={isAssistant ? "message message-assistant" : "message message-user"}>
      <div className="message-header">
        <span className="message-avatar">{isAssistant ? "AI" : "Y"}</span>
        <span className="message-time">{formatTime(message.createdAt)}</span>
      </div>

      {segments ? (
        segments.map((segment, index) =>
          segment.type === "table" ? (
            <div className="message-table-wrap" key={index}>
              <table className="message-table">
                <thead>
                  <tr>
                    {segment.headers.map((header, headerIndex) => (
                      <th key={headerIndex}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {segment.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="message-text" key={index}>
              {segment.content}
            </p>
          ),
        )
      ) : (
        <p className="message-text">{message.text}</p>
      )}

      {isAssistant && (
        <div className="message-actions">
          <button
            type="button"
            className={message.feedback ? "link-button active" : "link-button"}
            onClick={onOpenFeedback}
          >
            {message.feedback ? (
              <ThumbIcon direction={message.feedback === "helpful" ? "up" : "down"} size={13} />
            ) : null}
            Feedback
          </button>
          <button type="button" className="link-button" onClick={onExplain}>
            Explainability
          </button>
        </div>
      )}
    </div>
  );
}
