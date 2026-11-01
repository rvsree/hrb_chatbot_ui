import CopyButton from "./CopyButton";

// Phase 27 - same problem the login page's own "Need sample login
// credentials?" link solves (a blank field is the worst way to discover
// what to type), applied to the composer instead of the login form. All
// queries below are pulled directly from the real, already-tested golden
// dataset (resources/golden_dataset/golden_dataset.json and its own
// _conversational.json sibling) - none invented, same discipline that
// dataset's own _meta.description already holds itself to.
interface SampleQuery {
  text: string;
}

interface SampleCategory {
  title: string;
  note?: string;
  // A single-element list is one ordinary query; 2+ elements is a real,
  // already-tested multi-turn sequence - rendered as "Turn 1/2/3" so a
  // visitor knows to send them one at a time, not all at once.
  turns: SampleQuery[];
}

const CATEGORIES: SampleCategory[] = [
  {
    title: "HR policy basics",
    turns: [{ text: "What percentage does Amazing Bank match on my 401(k) contributions?" }],
  },
  {
    title: "",
    turns: [{ text: "Until what age are my children covered as dependents on my Amazing Bank medical plan?" }],
  },
  {
    title: "",
    turns: [{ text: "How many weeks of paid parental leave does Amazing Bank provide, and does it differ by gender?" }],
  },
  {
    title: "",
    turns: [{ text: "How long is the waiting period before Short-Term Disability benefits start, and can I use sick time during it?" }],
  },
  {
    title: "Follow-up conversations (the chatbot remembers earlier turns)",
    turns: [
      { text: "What percentage does Amazing Bank match on my 401(k) contributions?" },
      { text: "Is that available right away, or do I have to wait?" },
    ],
  },
  {
    title: "",
    turns: [
      { text: "How many days of paid bereavement leave do I get for the death of my spouse versus the death of a sibling?" },
      { text: "Is that leave fully paid?" },
    ],
  },
  {
    title: "Your own data (leave balance/history - a live lookup, not the knowledge base)",
    turns: [{ text: "What is my current leave balance?" }],
  },
  {
    title: "",
    turns: [{ text: "What unpaid leave requests have I submitted in the past?" }],
  },
  {
    title: "",
    turns: [
      { text: "What is my current leave balance, and what is Amazing Bank's sick leave policy?" },
      { text: "Based on that balance, do I have enough sick time to cover a 3-day absence?" },
    ],
  },
  {
    title: "Combining policy + your own data in one question",
    note: "Switch to Multi-Agent RAG in Settings first - this combination is its own capability, not the default mode.",
    turns: [
      { text: "What is the Amazing Bank parental leave policy, and what is my current leave balance?" },
      { text: "Which of those two - the parental leave policy or my current balance - would let me take more total days off right now?" },
    ],
  },
];

interface SampleQueriesModalProps {
  onClose: () => void;
  onSelect: (query: string) => void;
}

export default function SampleQueriesModal({ onClose, onSelect }: SampleQueriesModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <h2>Sample queries</h2>
        <p className="dev-note">
          Not sure what to ask? Click any query below to drop it into the message box - you can still edit it before
          sending.
        </p>

        <div className="sample-queries-list">
          {CATEGORIES.map((category, categoryIndex) => (
            <div key={categoryIndex} className="sample-queries-category">
              {category.title && <h3>{category.title}</h3>}
              {category.note && <p className="dev-note-inline">{category.note}</p>}
              <ul className="sample-queries-turns">
                {category.turns.map((turn, turnIndex) => (
                  <li key={turnIndex}>
                    {category.turns.length > 1 && <span className="sample-queries-turn-label">Turn {turnIndex + 1}</span>}
                    <span className="sample-queries-text">{turn.text}</span>
                    <CopyButton
                      text={turn.text}
                      label="query"
                      onCopied={() => {
                        onSelect(turn.text);
                        onClose();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
