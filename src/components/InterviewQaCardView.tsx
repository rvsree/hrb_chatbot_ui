import type { InterviewQaCard } from "../types";

interface InterviewQaCardViewProps {
  card: InterviewQaCard;
}

// Phase 187 - read-only render of one card, reusing the same visual theme
// as docs/dev-reference/interview-faqs/*.html (ported CSS, "iqa-" prefixed
// classes in App.css) - DB is the source of truth now, this is just the
// display, matching the user's own ask to keep the same look.
export default function InterviewQaCardView({ card }: InterviewQaCardViewProps) {
  return (
    <div className="iqa-wrap">
      <div className="iqa-q-card">
        <div className="iqa-q-head">
          <span className="iqa-q-text">{card.question}</span>
        </div>
        <div className="iqa-q-body">
          {card.hint && (
            <div className="iqa-part">
              <span className="iqa-part-label">Hint</span>
              <span className="iqa-hint">{card.hint}</span>
            </div>
          )}
          {card.concept && (
            <div className="iqa-part">
              <span className="iqa-part-label">Concept</span>
              <p className="iqa-concept">{card.concept}</p>
            </div>
          )}
          {(card.situation || card.task || card.action || card.result) && (
            <div className="iqa-part">
              <span className="iqa-part-label">Answer (STAR)</span>
              <div className="iqa-star-grid">
                {card.situation && (
                  <div className="iqa-star-box">
                    <span className="iqa-s-label">Situation</span>
                    <p>{card.situation}</p>
                  </div>
                )}
                {card.task && (
                  <div className="iqa-star-box">
                    <span className="iqa-s-label">Task</span>
                    <p>{card.task}</p>
                  </div>
                )}
                {card.action && (
                  <div className="iqa-star-box">
                    <span className="iqa-s-label">Action</span>
                    <p>{card.action}</p>
                  </div>
                )}
                {card.result && (
                  <div className="iqa-star-box">
                    <span className="iqa-s-label">Result</span>
                    <p>{card.result}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {card.project_link && (
            <div className="iqa-part">
              <span className="iqa-part-label">Project link</span>
              <div className="iqa-project-link">{card.project_link}</div>
            </div>
          )}
          {card.leadership_angle && (
            <div className="iqa-part">
              <span className="iqa-part-label">Leadership angle</span>
              <div className="iqa-leadership">{card.leadership_angle}</div>
            </div>
          )}
          {card.trade_offs.length > 0 && (
            <div className="iqa-part">
              <span className="iqa-part-label">Trade-offs and pitfalls</span>
              <ul className="iqa-pitfalls">
                {card.trade_offs.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {card.keywords.length > 0 && (
            <div className="iqa-part">
              <span className="iqa-part-label">Keywords</span>
              <table className="iqa-kw-table">
                <thead>
                  <tr>
                    <th>Term</th>
                    <th>Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {card.keywords.map((keyword, index) => (
                    <tr key={index}>
                      <td>{keyword.term}</td>
                      <td>{keyword.definition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {card.tech_stack.length > 0 && (
            <div className="iqa-part">
              <span className="iqa-part-label">Tech stack</span>
              <div className="iqa-tech-stack">
                {card.tech_stack.map((tech, index) => (
                  <span className="iqa-tech-pill" key={index}>
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
          {card.feature_references.length > 0 && (
            <div className="iqa-part">
              <span className="iqa-part-label">Feature references</span>
              <ul className="iqa-pitfalls">
                {card.feature_references.map((reference, index) => (
                  <li key={index}>
                    {reference.label} - <code>{reference.file_path}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
