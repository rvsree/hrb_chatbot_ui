import { useState } from "react";
import ThumbIcon from "./ThumbIcon";
import type { FeedbackVote } from "../types";

const REASON_TAGS = ["Incomplete answer", "Wrong information", "Missing citation", "Hard to understand"];

interface FeedbackModalProps {
  onClose: () => void;
  onSubmit: (vote: FeedbackVote, reasonTags: string[], notes: string) => void;
}

export default function FeedbackModal({ onClose, onSubmit }: FeedbackModalProps) {
  const [vote, setVote] = useState<FeedbackVote | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag],
    );
  }

  function handleSubmit() {
    if (!vote) {
      return;
    }
    onSubmit(vote, selectedTags, notes);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>Feedback</h2>

        <div className="thumb-row">
          <button
            type="button"
            className={vote === "helpful" ? "thumb-button thumb-selected-up" : "thumb-button"}
            onClick={() => setVote("helpful")}
            aria-label="Helpful"
          >
            <ThumbIcon direction="up" />
            <span>Helpful</span>
          </button>
          <button
            type="button"
            className={vote === "not_quite" ? "thumb-button thumb-selected-down" : "thumb-button"}
            onClick={() => setVote("not_quite")}
            aria-label="Not quite"
          >
            <ThumbIcon direction="down" />
            <span>Not quite</span>
          </button>
        </div>

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

        {vote && (
          <>
            <label htmlFor="feedback-notes">Anything else? (optional)</label>
            <textarea
              id="feedback-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </>
        )}

        <p className="dev-note">
          Feedback is attributed to your employee id, not anonymous.
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!vote}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
