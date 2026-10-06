import type { ChatMessage } from "../types";

interface ExplainabilityModalProps {
  message: ChatMessage;
  onClose: () => void;
}

export default function ExplainabilityModal({ message, onClose }: ExplainabilityModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability</h2>

        <section>
          <h3>Model</h3>
          <p>{message.modelUsed ?? "unknown"}</p>
        </section>

        <section>
          <h3>Cost, tokens, latency</h3>
          <p className="dev-note">
            Not available yet - the backend logs this per call (see <code>call_logger.py</code>)
            but no endpoint returns it today (see BACKLOG.md's Phase 95 entry).
          </p>
        </section>

        {message.tasks && message.tasks.length > 0 && (
          <section>
            <h3>Agent tasks (multi-agentic-rag)</h3>
            <ul className="citation-list">
              {message.tasks.map((task, index) => (
                <li key={`${task.agent}-${index}`}>
                  <strong>{task.agent}</strong>: {task.focus}
                </li>
              ))}
            </ul>
          </section>
        )}

        {message.toolsUsed && (
          <section>
            <h3>
              Call trace{message.iterations !== undefined && ` (${message.iterations} iteration${message.iterations === 1 ? "" : "s"})`}
            </h3>
            {message.toolsUsed.length > 0 ? (
              <ol className="citation-list">
                {message.toolsUsed.map((call, index) => (
                  <li key={`${call.tool_name}-${index}`}>
                    <strong>{call.tool_name}</strong>: {call.tool_input}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No tool calls recorded for this message.</p>
            )}
          </section>
        )}

        <section>
          <h3>Citations</h3>
          {message.sources && message.sources.length > 0 ? (
            <ul className="citation-list">
              {message.sources.map((source) => (
                <li key={`${source.document_id}-${source.chunk_index}`}>
                  <strong>{source.filename}</strong>, chunk {source.chunk_index}
                  {source.score !== null && <span> - score {source.score.toFixed(3)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No sources recorded for this message.</p>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
