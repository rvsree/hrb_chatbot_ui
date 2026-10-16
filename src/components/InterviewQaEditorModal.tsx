import { useState } from "react";
import { ApiRequestError, createInterviewQaCard, updateInterviewQaCard } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { FeatureReference, InterviewQaCard, InterviewQaCardFields, KeywordEntry } from "../types";

interface InterviewQaEditorModalProps {
  card: InterviewQaCard | null; // null = creating a new card
  defaultTopic: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const BLANK_FIELDS: InterviewQaCardFields = {
  topic: "",
  topic_order: 0,
  card_order: 0,
  question: "",
  hint: "",
  concept: "",
  situation: "",
  task: "",
  action: "",
  result: "",
  project_link: "",
  leadership_angle: "",
  trade_offs: [],
  keywords: [],
  tech_stack: [],
  feature_references: [],
};

// Phase 187 - manual add/edit form for one Q&A card. Every field maps
// directly to InterviewQaCardFields (same shape create and update both
// send) - this is a plain form, not the themed display (InterviewQaCardView
// handles that).
export default function InterviewQaEditorModal({ card, defaultTopic, onClose, onSaved }: InterviewQaEditorModalProps) {
  const { identity } = useIdentity();
  const [fields, setFields] = useState<InterviewQaCardFields>(
    card ?? { ...BLANK_FIELDS, topic: defaultTopic ?? "" },
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function setField<K extends keyof InterviewQaCardFields>(key: K, value: InterviewQaCardFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function setStringListItem(key: "trade_offs" | "tech_stack", index: number, value: string) {
    const next = [...fields[key]];
    next[index] = value;
    setField(key, next);
  }

  function addStringListItem(key: "trade_offs" | "tech_stack") {
    setField(key, [...fields[key], ""]);
  }

  function removeStringListItem(key: "trade_offs" | "tech_stack", index: number) {
    setField(key, fields[key].filter((_, i) => i !== index));
  }

  function setKeyword(index: number, patch: Partial<KeywordEntry>) {
    const next = [...fields.keywords];
    next[index] = { ...next[index], ...patch };
    setField("keywords", next);
  }

  function setFeatureReference(index: number, patch: Partial<FeatureReference>) {
    const next = [...fields.feature_references];
    next[index] = { ...next[index], ...patch };
    setField("feature_references", next);
  }

  async function handleSave() {
    if (!identity) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      if (card) {
        await updateInterviewQaCard(identity, card.id, fields);
      } else {
        await createInterviewQaCard(identity, fields);
      }
      onSaved();
    } catch (error) {
      setSaveError(error instanceof ApiRequestError ? error.message : "Something went wrong reaching the backend.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2>{card ? `Edit card #${card.id}` : "Add a new Q&A card"}</h2>

        <div className="iqa-editor-field">
          <label>Topic</label>
          <input type="text" value={fields.topic} onChange={(e) => setField("topic", e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="iqa-editor-field" style={{ flex: 1 }}>
            <label>Topic order</label>
            <input
              type="number"
              value={fields.topic_order}
              onChange={(e) => setField("topic_order", Number(e.target.value))}
            />
          </div>
          <div className="iqa-editor-field" style={{ flex: 1 }}>
            <label>Card order</label>
            <input
              type="number"
              value={fields.card_order}
              onChange={(e) => setField("card_order", Number(e.target.value))}
            />
          </div>
        </div>
        <div className="iqa-editor-field">
          <label>Question</label>
          <textarea rows={2} value={fields.question} onChange={(e) => setField("question", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Hint</label>
          <input type="text" value={fields.hint ?? ""} onChange={(e) => setField("hint", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Concept</label>
          <textarea rows={3} value={fields.concept ?? ""} onChange={(e) => setField("concept", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Situation</label>
          <textarea rows={2} value={fields.situation ?? ""} onChange={(e) => setField("situation", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Task</label>
          <textarea rows={2} value={fields.task ?? ""} onChange={(e) => setField("task", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Action</label>
          <textarea rows={2} value={fields.action ?? ""} onChange={(e) => setField("action", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Result</label>
          <textarea rows={2} value={fields.result ?? ""} onChange={(e) => setField("result", e.target.value)} />
        </div>
        <div className="iqa-editor-field">
          <label>Project link</label>
          <textarea
            rows={2}
            value={fields.project_link ?? ""}
            onChange={(e) => setField("project_link", e.target.value)}
          />
        </div>
        <div className="iqa-editor-field">
          <label>Leadership angle</label>
          <textarea
            rows={2}
            value={fields.leadership_angle ?? ""}
            onChange={(e) => setField("leadership_angle", e.target.value)}
          />
        </div>

        <div className="iqa-editor-field">
          <label>Trade-offs and pitfalls</label>
          {fields.trade_offs.map((item, index) => (
            <div className="iqa-list-row" key={index}>
              <input type="text" value={item} onChange={(e) => setStringListItem("trade_offs", index, e.target.value)} />
              <button type="button" className="secondary" onClick={() => removeStringListItem("trade_offs", index)}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => addStringListItem("trade_offs")}>
            + Add trade-off
          </button>
        </div>

        <div className="iqa-editor-field">
          <label>Keywords</label>
          {fields.keywords.map((keyword, index) => (
            <div className="iqa-list-row" key={index}>
              <input
                type="text"
                placeholder="Term"
                value={keyword.term}
                onChange={(e) => setKeyword(index, { term: e.target.value })}
              />
              <input
                type="text"
                placeholder="Definition"
                value={keyword.definition}
                onChange={(e) => setKeyword(index, { definition: e.target.value })}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setField("keywords", fields.keywords.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setField("keywords", [...fields.keywords, { term: "", definition: "" }])}
          >
            + Add keyword
          </button>
        </div>

        <div className="iqa-editor-field">
          <label>Tech stack</label>
          {fields.tech_stack.map((item, index) => (
            <div className="iqa-list-row" key={index}>
              <input type="text" value={item} onChange={(e) => setStringListItem("tech_stack", index, e.target.value)} />
              <button type="button" className="secondary" onClick={() => removeStringListItem("tech_stack", index)}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => addStringListItem("tech_stack")}>
            + Add tech
          </button>
        </div>

        <div className="iqa-editor-field">
          <label>Feature references</label>
          {fields.feature_references.map((reference, index) => (
            <div className="iqa-list-row" key={index}>
              <input
                type="text"
                placeholder="Label"
                value={reference.label}
                onChange={(e) => setFeatureReference(index, { label: e.target.value })}
              />
              <input
                type="text"
                placeholder="File path"
                value={reference.file_path}
                onChange={(e) => setFeatureReference(index, { file_path: e.target.value })}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setField("feature_references", fields.feature_references.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setField("feature_references", [...fields.feature_references, { label: "", file_path: "" }])}
          >
            + Add feature reference
          </button>
        </div>

        {saveError && <p className="error-banner">{saveError}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving || !fields.topic.trim() || !fields.question.trim()}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
