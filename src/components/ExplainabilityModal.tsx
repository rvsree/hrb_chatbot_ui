import { useState, type ReactNode } from "react";
import { useIdentity } from "../context/IdentityContext";
import type { ChatMessage, RetrievedChunk, ToolCallInfo } from "../types";

interface ExplainabilityModalProps {
  message: ChatMessage;
  originalQuery: string | null;
  onClose: () => void;
}

// Labels for the known tool_type values; anything else (a future source
// type the backend starts sending) falls back to "Other" rather than
// being dropped or rendered as a raw snake_case string.
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

interface KnowledgeSourceEntry {
  name: string;
  detail: string;
  latencyMs: number | null;
  failed: boolean;
}

// Single place every pipeline mode's "where did this answer's knowledge
// come from" renders through - real tool/agent calls when there are any,
// else a synthetic single entry describing a plain vector-store search
// (genai-rag's non-agentic path, which never calls a "tool" at all).
function knowledgeSourceGroups(message: ChatMessage): [string, KnowledgeSourceEntry[]][] {
  if (message.toolsUsed && message.toolsUsed.length > 0) {
    const groups = new Map<string, ToolCallInfo[]>();
    for (const call of message.toolsUsed) {
      const existing = groups.get(call.tool_type);
      if (existing) {
        existing.push(call);
      } else {
        groups.set(call.tool_type, [call]);
      }
    }
    return [...groups.entries()].map(([toolType, calls]) => [
      toolType,
      calls.map((call) => ({
        name: call.tool_name,
        detail: call.tool_input,
        latencyMs: call.latency_ms,
        failed: !call.success,
      })),
    ]);
  }

  if (message.retrievalInfo) {
    const filter = message.retrievalInfo.applied_filter;
    return [
      [
        "vector_db",
        [
          {
            name: message.retrievalInfo.vector_db,
            detail: `${message.retrievalInfo.search_strategy} search${filter ? ` - filter: ${JSON.stringify(filter)}` : ""}`,
            latencyMs: null,
            failed: false,
          },
        ],
      ],
    ];
  }

  return [];
}

// Plain <details>/<summary> - native expand/collapse, no extra state to
// manage, keyboard/accessibility support for free. `defaultOpen` only sets
// the INITIAL state; the browser handles toggling from there, so every
// section stays independently expandable regardless of the others.
function CollapsibleSection({
  title,
  defaultOpen,
  nested,
  children,
}: {
  title: ReactNode;
  defaultOpen: boolean;
  nested?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={nested ? "explainability-section explainability-section-nested" : "explainability-section"} open={defaultOpen}>
      <summary>{title}</summary>
      <div className="explainability-section-body">{children}</div>
    </details>
  );
}

function chunkKey(source: RetrievedChunk): string {
  return `${source.document_id}-${source.chunk_index}`;
}

// Phase 136 - a deliberately small, separate view for a Chat GenAI Workflow
// answer. No Knowledge Sources/Citations/LLM Context-with-chunk-attribution
// sections - there is no vector store or persisted KB in this path, so
// none of the main view's sections apply.
function AdhocExplainability({ message, originalQuery, onClose }: ExplainabilityModalProps) {
  const adhoc = message.adhoc!;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability - Chat GenAI Workflow</h2>
        <p className="dev-note-inline">
          Ad-hoc document chat - answered only from attached files, no knowledge base or vector store involved.
        </p>

        <div className="panel panel-success">
          <span className="panel-eyebrow">User Query</span>
          <p className="kb-query-text">{originalQuery ?? "Not available for this message."}</p>
        </div>

        <div className="panel panel-info">
          <span className="panel-eyebrow">Files Read</span>
          {adhoc.filesUsed.length > 0 ? (
            <ul className="citation-list">
              {adhoc.filesUsed.map((filename) => (
                <li key={filename}>{filename}</li>
              ))}
            </ul>
          ) : (
            <p>The agent answered without reading any attached file.</p>
          )}
        </div>

        <div className="panel panel-info">
          <span className="panel-eyebrow">Latency &amp; Tokens</span>
          <ul className="citation-list">
            <li>Total time: {adhoc.totalMs.toFixed(0)}ms</li>
            <li>LLM calls: {adhoc.llmCallCount}</li>
            <li>Reasoning steps: {adhoc.iterations}</li>
            {message.modelUsed && <li>Model: {message.modelUsed}</li>}
            {adhoc.tokenUsage ? (
              <li>
                Tokens: {adhoc.tokenUsage.prompt_tokens} prompt + {adhoc.tokenUsage.completion_tokens} completion ={" "}
                {adhoc.tokenUsage.total_tokens} total
              </li>
            ) : (
              <li>Tokens: n/a</li>
            )}
          </ul>
        </div>

        {adhoc.emailSentTo && (
          <div className="panel panel-success">
            <span className="panel-eyebrow">Email</span>
            <p>Answer emailed to {adhoc.emailSentTo}.</p>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExplainabilityModal(props: ExplainabilityModalProps) {
  const { message, originalQuery, onClose } = props;
  const { identity } = useIdentity();
  const knowledgeGroups = knowledgeSourceGroups(message);
  const llmContext = message.explainability?.llm_context;
  const sources = message.sources ?? [];
  const [selectedChunkKey, setSelectedChunkKey] = useState<string | null>(null);
  const selectedChunk = sources.find((source) => chunkKey(source) === selectedChunkKey) ?? null;

  if (message.adhoc) {
    return <AdhocExplainability {...props} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card explainability-card" onClick={(event) => event.stopPropagation()}>
        <h2>Explainability</h2>

        <CollapsibleSection title="Metrics" defaultOpen>
          <div className="explainability-row">
            {knowledgeGroups.length > 0 && (
              <div className="panel panel-info">
                <span className="panel-eyebrow">Knowledge Sources</span>
                {knowledgeGroups.map(([toolType, entries]) => (
                  <div className="knowledge-source-group" key={toolType}>
                    <span className="knowledge-source-group-label">
                      {toolTypeLabel(toolType)} ({entries.length})
                    </span>
                    <ul className="citation-list">
                      {entries.map((entry, index) => (
                        <li key={`${entry.name}-${index}`}>
                          <strong>{entry.name}</strong>: {entry.detail}
                          {entry.failed && <span className="knowledge-source-failed"> - failed</span>}
                          {entry.latencyMs !== null && <span> - {entry.latencyMs.toFixed(0)}ms</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {message.tasks && message.tasks.length > 0 && (
              <div className="panel panel-info">
                <span className="panel-eyebrow">Agent Tasks (multi-agentic-rag)</span>
                <ul className="citation-list">
                  {message.tasks.map((task, index) => (
                    <li key={`${task.agent}-${index}`}>
                      <strong>{task.agent}</strong>: {task.focus}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="explainability-row">
            {message.explainability ? (
              <div className={message.explainability.served_from_cache ? "panel panel-success" : "panel panel-info"}>
                <span className="panel-eyebrow">Latency &amp; Tokens</span>
                <ul className="citation-list">
                  {message.explainability.served_from_cache && <li>Served from cache</li>}
                  <li>Total time: {message.explainability.latency_ms.total.toFixed(0)}ms</li>
                  {message.explainability.latency_ms.retrieval !== null && (
                    <li>Retrieval: {message.explainability.latency_ms.retrieval.toFixed(0)}ms</li>
                  )}
                  {message.explainability.latency_ms.generation !== null && (
                    <li>Generation: {message.explainability.latency_ms.generation.toFixed(0)}ms</li>
                  )}
                  <li>LLM calls: {message.explainability.llm_call_count}</li>
                  {message.iterations !== undefined && <li>Reasoning steps: {message.iterations}</li>}
                  {message.modelUsed && <li>Model: {message.modelUsed}</li>}
                  {message.explainability.temperature !== null && (
                    <li>Temperature: {message.explainability.temperature}</li>
                  )}
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
                <span className="panel-eyebrow">Latency &amp; Tokens</span>
                <p>Not tracked for this pipeline mode yet (genai-rag only so far - see RAG-ROADMAP.md Phase 107).</p>
              </div>
            )}

            {message.explainability?.eval_scores ? (
              <div
                className={
                  message.explainability.eval_scores.groundedness_verdict === "GROUNDED" &&
                  message.explainability.eval_scores.completeness_verdict === "COMPLETE"
                    ? "panel panel-success"
                    : "panel panel-warning"
                }
              >
                <span className="panel-eyebrow">Eval Scores</span>
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
                  <li>Judge: hand-rolled LLM-as-judge prompts (IK FDE Module 5 pattern) - not DeepEval or a third-party eval library.</li>
                  <li>
                    F1 score: not available live - it needs a known relevant-chunk set to compare retrieval against,
                    which only exists offline (the 22-case golden dataset), not for a real, unlabeled live question.
                  </li>
                </ul>
                <p className="dev-note-inline">
                  Checks the final answer only (groundedness/completeness) - retrieval quality (precision/recall/F1)
                  is measured offline against the golden dataset, not per live query. Reused, not re-judged, on a
                  cache hit.
                </p>
              </div>
            ) : (
              <div className="panel panel-warning">
                <span className="panel-eyebrow">Eval Scores</span>
                <p>Not available for this message (no retrieved context to check groundedness against).</p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="LLM Context" defaultOpen={false}>
          {llmContext ? (
            <>
              {llmContext.turns.length === 0 && llmContext.mcp_tool_calls.length === 0 && (
                <p>Nothing captured for this answer.</p>
              )}
              {llmContext.turns.map((turn, index) => (
                <CollapsibleSection
                  key={`${turn.label}-${index}`}
                  nested
                  defaultOpen={llmContext.turns.length === 1}
                  title={
                    <>
                      <span className="kb-chunk-sequence">Q{index + 1}</span> {turn.label}
                    </>
                  }
                >
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Question:</span>
                    <p>{turn.label}</p>
                  </div>
                  {turn.chat_history.length > 0 && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Chat history sent:</span>
                      <pre className="llm-context-pre">
                        {turn.chat_history.map((m) => `[${m.role}] ${m.content}`).join("\n")}
                      </pre>
                    </div>
                  )}
                  {turn.system_prompt && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">System prompt:</span>
                      <pre className="llm-context-pre">{turn.system_prompt}</pre>
                    </div>
                  )}
                  {turn.human_message && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Human message:</span>
                      <pre className="llm-context-pre">{turn.human_message}</pre>
                    </div>
                  )}
                  {turn.system_prompt === null && turn.human_message === null && (
                    <p className="dev-note-inline">
                      {turn.label.includes("not yet built") ? "" : "Prompt not captured for this turn."}
                    </p>
                  )}
                  {turn.response && (
                    <div className="llm-context-block">
                      <span className="dev-note-inline">Response:</span>
                      <pre className="llm-context-pre">{turn.response}</pre>
                    </div>
                  )}
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Response KB source:</span>
                    {llmContext.turns.length === 1 && sources.length > 0 ? (
                      <ul className="citation-list">
                        {sources.map((source) => (
                          <li key={chunkKey(source)}>
                            {source.filename}, chunk {source.chunk_index}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dev-note-inline">
                        {sources.length === 0
                          ? "No chunks retrieved for this answer."
                          : "Per-sub-question chunk attribution isn't tracked yet - see Citations below for the full retrieved set across all sub-questions."}
                      </p>
                    )}
                  </div>
                </CollapsibleSection>
              ))}
              {llmContext.mcp_tool_calls.map((call, index) => (
                <CollapsibleSection
                  key={`${call.tool_name}-${index}`}
                  nested
                  defaultOpen={llmContext.turns.length === 0}
                  title={
                    <>
                      <span className="kb-chunk-sequence">Q{llmContext.turns.length + index + 1}</span> MCP: {call.tool_name}
                    </>
                  }
                >
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Arguments:</span>
                    <pre className="llm-context-pre">{JSON.stringify(call.arguments, null, 2)}</pre>
                  </div>
                  <div className="llm-context-block">
                    <span className="dev-note-inline">Raw result:</span>
                    <pre className="llm-context-pre">{call.raw_result.join("\n")}</pre>
                  </div>
                </CollapsibleSection>
              ))}
            </>
          ) : (
            <div className="panel panel-warning">
              <p>
                Not tracked for this pipeline mode yet (genai-rag only so far - see RAG-ROADMAP.md Phase 132), or
                this answer was served from cache (nothing was actually sent this call).
              </p>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Citations" defaultOpen={false}>
          <div className="panel panel-success">
            <span className="panel-eyebrow">User Query</span>
            <p className="kb-query-text">{originalQuery ?? "Not available for this message."}</p>
          </div>

          <div className="panel panel-info">
            <span className="panel-eyebrow">User Profile</span>
            {identity ? (
              <ul className="citation-list">
                <li>Employee ID: {identity.employee_id}</li>
                <li>Name: {identity.full_name}</li>
                <li>Role: {identity.role}</li>
              </ul>
            ) : (
              <p>Not signed in.</p>
            )}
          </div>

          <div className="panel panel-success">
            <span className="panel-eyebrow">Retrieved Chunks ({sources.length})</span>
            {sources.length > 0 ? (
              <ol className="kb-chunk-list">
                {sources.map((source, index) => (
                  <li key={chunkKey(source)}>
                    <button
                      type="button"
                      className={selectedChunkKey === chunkKey(source) ? "link-button citation-link-active" : "link-button"}
                      onClick={() => setSelectedChunkKey(selectedChunkKey === chunkKey(source) ? null : chunkKey(source))}
                    >
                      <span className="kb-chunk-sequence">#{index + 1}</span> {source.filename}, chunk{" "}
                      {source.chunk_index}
                      {source.score !== null && <span> - score {source.score.toFixed(3)}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No sources recorded for this message.</p>
            )}
          </div>

          {selectedChunk && (
            <div className="panel panel-info">
              <span className="panel-eyebrow">Chunk Detail</span>
              <table className="kb-chunk-grid">
                <tbody>
                  <tr>
                    <th>Filename</th>
                    <td>{selectedChunk.filename}</td>
                  </tr>
                  <tr>
                    <th>Document ID</th>
                    <td>{selectedChunk.document_id}</td>
                  </tr>
                  <tr>
                    <th>Chunk index</th>
                    <td>{selectedChunk.chunk_index}</td>
                  </tr>
                  <tr>
                    <th>Score</th>
                    <td>{selectedChunk.score !== null ? selectedChunk.score.toFixed(3) : "n/a (MMR/MultiQuery result)"}</td>
                  </tr>
                  <tr>
                    <th>Eval score</th>
                    <td>
                      {message.explainability?.eval_scores
                        ? `Groundedness ${message.explainability.eval_scores.groundedness.toFixed(2)}, Completeness ${message.explainability.eval_scores.completeness.toFixed(2)} (answer-level - no per-chunk eval score is computed)`
                        : "Not available for this message."}
                    </td>
                  </tr>
                  {message.retrievalInfo && (
                    <tr>
                      <th>Retrieval metadata</th>
                      <td>
                        {message.retrievalInfo.vector_db} / {message.retrievalInfo.search_strategy}
                        {message.retrievalInfo.applied_filter
                          ? ` - filter: ${JSON.stringify(message.retrievalInfo.applied_filter)}`
                          : ""}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="llm-context-block">
                <span className="dev-note-inline">Chunk text:</span>
                <pre className="llm-context-pre">{selectedChunk.text}</pre>
              </div>
            </div>
          )}
        </CollapsibleSection>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
