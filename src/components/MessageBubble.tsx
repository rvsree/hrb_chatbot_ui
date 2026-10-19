import { useState } from "react";
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

// 2026-10-18 - user-directed: copy-to-clipboard for every past query/
// response, not just "?" popovers. navigator.clipboard didn't exist
// anywhere in this app before this - a new pattern, not a reuse.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be refused (older desktop apps, some webviews) -
      // nothing to fall back to here (no stable DOM node to select from,
      // unlike HelpPopover's own body) - fail quietly rather than break the chat.
    }
  }

  // 2026-10-19 - user-requested: icon instead of the word "Copy", same
  // pattern as HelpPopover's own copy button - label moved to a hover
  // tooltip (native `title`) instead of always-visible text.
  return (
    <button
      type="button"
      className="link-button icon-button"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy content"}
      aria-label={copied ? "Copied" : "Copy content"}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 8.5L6.2 12 13 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="5.5" y="5.5" width="8" height="9" rx="1.3" />
          <path d="M3.5 10.5v-7a1.3 1.3 0 0 1 1.3-1.3h6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
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

      <div className="message-actions">
        <CopyButton text={message.text} />
        {isAssistant && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
