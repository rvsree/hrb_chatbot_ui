import { useState } from "react";
import type { FeedbackVote } from "../types";

const REASON_TAGS = ["Incomplete answer", "Wrong information", "Missing citation", "Hard to understand"];

interface FeedbackModalProps {
  vote: FeedbackVote;
  onClose: () => void;
  onSubmit: (reasonTags: string[], notes: string) => void;
}

export default function FeedbackModal({ vote, onClose, onSubmit }: FeedbackModalProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag],
    );
  }

  function handleSubmit() {
    onSubmit(selectedTags, notes);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>{vote === "helpful" ? "Glad it helped" : "What went wrong?"}</h2>

        {vote === "not_quite" && (
          <div className="tag-row">
            {REASON_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={selectedTags.includes(tag) ? "tag tag-selected" : "tag"}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <label htmlFor="feedback-notes">Anything else? (optional)</label>
        <textarea
          id="feedback-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
        />

        <p className="dev-note">
          Feedback is attributed to your employee id, not anonymous. There's no backend endpoint
          to store it yet (see BACKLOG.md) - this stays in your browser only for now.
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
