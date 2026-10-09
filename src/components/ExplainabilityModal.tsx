import type { ChatMessage, ToolCallInfo } from "../types";

interface ExplainabilityModalProps {
  message: ChatMessage;
  onClose: () => void;
}

// Phase 126 - labels for the known tool_type values; anything else (a
// future source type the backend starts sending) falls back to "Other"
// rather than being dropped or rendered as a raw snake_case string.
const KNOWN_TOOL_TYPE_LABELS: Record<string, string> = {
  vector_db: "Vector DB",
  mcp: "MCP",
  web_search: "Web Search",
  sql_db: "SQL DB",
  other: "Other",
};

function toolTypeLabel(toolType: string): string {
  return KNOWN_TOOL_TYPE_LABELS[toolType] ?? "Other";
}

function groupByToolType(tools: ToolCallInfo[]): [string, ToolCallInfo[]][] {
  const groups = new Map<string, ToolCallInfo[]>();
  for (const tool of tools) {
    const existing = groups.get(tool.tool_type);
    if (existing) {
      existing.push(tool);
    } else {
      groups.set(tool.tool_type, [tool]);
    }
  }
  return [...groups.entries()];
}

function sourceLabel(message: ChatMessage): string {
  if (message.explainability?.routed_to) {
    return `MCP tool: ${message.explainability.routed_to}`;
  }
  if (message.explainability?.served_from_cache) {
    return "Cache";
  }
  if (message.tasks && message.tasks.length > 0) {
    const agents = [...new Set(message.tasks.map((task) => task.agent))];
    return `Multi-agent (${agents.join(", ")})`;
  }
  if (message.toolsUsed && message.toolsUsed.length > 0) {
    const tools = [...new Set(message.toolsUsed.map((call) => call.tool_name))];
    return `Agent (${tools.join(", ")})`;
  }
  if (message.retrievalInfo) {
    return `Live RAG (${message.retrievalInfo.search_strategy})`;
  }
  if (message.explainability) {
    return "Live";
  }
  return "Unknown";
}

export default function ExplainabilityModal({ message, onClose }: ExplainabilityModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability</h2>

        {(message.explainability || message.retrievalInfo) && (
          <div
            className={
              message.explainability?.routed_to
                ? "panel panel-warning"
                : message.explainability?.served_from_cache
                  ? "panel panel-success"
                  : "panel panel-info"
            }
          >
            <span className="panel-eyebrow">How this was answered</span>
            <ul className="citation-list">
              <li>Source: {sourceLabel(message)}</li>
              {message.retrievalInfo && !message.explainability?.routed_to && (
                <>
                  <li>Vector DB: {message.retrievalInfo.vector_db}</li>
                  {message.retrievalInfo.applied_filter && (
                    <li>Applied filter: {JSON.stringify(message.retrievalInfo.applied_filter)}</li>
                  )}
                </>
              )}
            </ul>
          </div>
        )}

        {message.explainability ? (
          <div className={message.explainability.served_from_cache ? "panel panel-success" : "panel panel-info"}>
            <span className="panel-eyebrow">Latency &amp; tokens</span>
            <ul className="citation-list">
              <li>Total time: {message.explainability.latency_ms.total.toFixed(0)}ms</li>
              {message.explainability.latency_ms.retrieval !== null && (
                <li>Retrieval: {message.explainability.latency_ms.retrieval.toFixed(0)}ms</li>
              )}
              {message.explainability.latency_ms.generation !== null && (
                <li>Generation: {message.explainability.latency_ms.generation.toFixed(0)}ms</li>
              )}
              <li>LLM calls: {message.explainability.llm_call_count}</li>
              {message.explainability.token_usage ? (
                <li>
                  Tokens: {message.explainability.token_usage.prompt_tokens} prompt +{" "}
                  {message.explainability.token_usage.completion_tokens} completion ={" "}
                  {message.explainability.token_usage.total_tokens} total
                </li>
              ) : (
                <li>Tokens: n/a (no LLM call this time)</li>
              )}
            </ul>
            <p className="dev-note-inline">Dollar cost is intentionally out of scope - see BACKLOG.md.</p>
          </div>
        ) : (
          <div className="panel panel-warning">
            <span className="panel-eyebrow">Cost, tokens, latency</span>
            <p>Not tracked for this pipeline mode yet (genai-rag only so far - see RAG-ROADMAP.md Phase 107).</p>
          </div>
        )}

        {message.explainability?.eval_scores && (
          <div
            className={
              message.explainability.eval_scores.groundedness_verdict === "GROUNDED" &&
              message.explainability.eval_scores.completeness_verdict === "COMPLETE"
                ? "panel panel-success"
                : "panel panel-warning"
            }
          >
            <span className="panel-eyebrow">Eval scores (live, LLM-as-judge)</span>
            <ul className="citation-list">
              <li>
                Groundedness: {message.explainability.eval_scores.groundedness.toFixed(2)} -{" "}
                {message.explainability.eval_scores.groundedness_verdict}
              </li>
              <li>
                Completeness: {message.explainability.eval_scores.completeness.toFixed(2)} -{" "}
                {message.explainability.eval_scores.completeness_verdict}
              </li>
              {message.explainability.latency_ms.eval !== null && (
                <li>Judging time: {message.explainability.latency_ms.eval.toFixed(0)}ms</li>
              )}
            </ul>
            <p className="dev-note-inline">
              Same prompts as the offline golden-dataset harness - reused, not re-judged, on a cache hit.
            </p>
          </div>
        )}

        {message.tasks && message.tasks.length > 0 && (
          <div className="panel panel-info">
            <span className="panel-eyebrow">Agent tasks (multi-agentic-rag)</span>
            <ul className="citation-list">
              {message.tasks.map((task, index) => (
                <li key={`${task.agent}-${index}`}>
                  <strong>{task.agent}</strong>: {task.focus}
                </li>
              ))}
            </ul>
          </div>
        )}

        {message.toolsUsed && !(message.tasks && message.tasks.length > 0) && (
          <div className="panel panel-info">
            <span className="panel-eyebrow">
              Call trace{message.iterations !== undefined && ` - ${message.iterations} iteration${message.iterations === 1 ? "" : "s"}`}
            </span>
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
          </div>
        )}

        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="panel panel-info">
            <span className="panel-eyebrow">Knowledge Sources</span>
            {groupByToolType(message.toolsUsed).map(([toolType, calls]) => (
              <div className="knowledge-source-group" key={toolType}>
                <span className="knowledge-source-group-label">
                  {toolTypeLabel(toolType)} ({calls.length})
                </span>
                <ul className="citation-list">
                  {calls.map((call, index) => (
                    <li key={`${call.tool_name}-${index}`}>
                      <strong>{call.tool_name}</strong>
                      {!call.success && <span className="knowledge-source-failed"> - failed</span>}
                      {call.latency_ms !== null && <span> - {call.latency_ms.toFixed(0)}ms</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="panel panel-success">
          <span className="panel-eyebrow">Citations</span>
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
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
