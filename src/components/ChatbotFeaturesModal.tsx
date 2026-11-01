import CopyButton from "./CopyButton";

// Phase 30 - "Chatbot Features" link, right below "Sample queries" -
// same purpose (help a visitor understand what they're looking at) but
// as an intro/overview instead of clickable examples. Same modal shell
// and section formatting as SampleQueriesModal (.modal-card-wide,
// .modal-section/.modal-section-list).
//
// Phase 31 - rewritten around real user-journey capabilities rather than
// a flat feature list: every capability a visitor can actually click or
// type into is paired with a "Try" query (same CopyButton-into-composer
// pattern as SampleQueriesModal) or a plain "Try it" hint when the
// capability isn't a typed question (Request Leave, attaching a file,
// Explainability, document upload), plus a "Learn more" link to the real
// README section documenting it - no invented docs, same repos/anchors
// LoginPage.tsx's own "Project documentation" link already uses.
// Deliberately dropped: the cold-start/infra-pause note and the
// mode-dependent-routing note from the old limitations list - both are
// backend/ops detail, not something a visitor is here to learn about.
interface CoreCapability {
  title: string;
  text: string;
  note?: string;
  tryQuery?: string;
  tryHint?: string;
  learnMoreHref?: string;
}

interface FeaturesSection {
  title: string;
  paragraphs: string[];
}

const PLATFORM_README = "https://github.com/rvsree/hrb_emp_assist/blob/master/README.md";
const CHATBOT_README = "https://github.com/rvsree/hrb_chatbot_service/blob/master/README.md";

const INTRO_SECTION: FeaturesSection = {
  title: "What is this?",
  paragraphs: [
    "This is an HR benefits assistant for Amazing Bank employees. Instead of digging through PDFs or waiting on an email reply, you can just ask it a question in plain English - about your 401(k), health plan, PTO, tuition assistance, disability coverage, or leave policies - and get a straight answer, right away.",
  ],
};

// Each of these is something a visitor logged in here can actually go do,
// in roughly the order they'd naturally meet them in a conversation.
const CORE_CAPABILITIES: CoreCapability[] = [
  {
    title: "Ask a policy question (RAG retrieval)",
    text: "Ask a real policy question and get an answer grounded in Amazing Bank's actual benefits documents - retrieved from the knowledge base, not guessed or made up.",
    tryQuery: "What percentage does Amazing Bank match on my 401(k) contributions?",
    learnMoreHref: `${CHATBOT_README}#what-this-repo-demonstrates`,
  },
  {
    title: "Ask a natural follow-up",
    text: "The chatbot remembers what you already asked in this conversation, so a follow-up doesn't need to repeat the context.",
    tryHint: "Try it: ask the 401(k) question above, then ask \"Is that available right away, or do I have to wait?\"",
    learnMoreHref: `${CHATBOT_README}#what-this-repo-demonstrates`,
  },
  {
    title: "Look up your own data",
    text: "Ask about your own leave balance or past leave requests - answered by a live lookup against the HR system, not the static policy documents.",
    tryQuery: "What is my current leave balance?",
    learnMoreHref: `${PLATFORM_README}#what-this-platform-actually-does`,
  },
  {
    title: "Combine policy and your own data",
    text: "Ask something that needs both a policy answer and your own data at once, in a single question.",
    note: "Switch to Multi-Agent RAG in Settings first - this combination is its own mode, not the default.",
    tryQuery: "What is my current leave balance, and what is Amazing Bank's sick leave policy?",
    learnMoreHref: `${CHATBOT_README}#what-this-repo-demonstrates`,
  },
  {
    title: "Request unpaid leave (a real person decides)",
    text: "Need an unpaid leave request actually approved, not just answered? The chatbot hands it off to a real HR Support identity, who reviews and resolves it - you're emailed the outcome, and the conversation picks back up where it left off.",
    tryHint: "Try it: click \"Request Leave\" to the left of the message box.",
    learnMoreHref: `${CHATBOT_README}#leave-requests-human-in-the-loop-approval`,
  },
  {
    title: "Ask about a file you attach",
    text: "Attach a PDF, Word doc, or CSV right in the chat and ask about just that file - answered from it directly, for this conversation only, not added to the shared knowledge base.",
    tryHint: "Try it: attach a document with the paperclip icon, then ask \"Summarize this document.\"",
  },
  {
    title: "See why it answered that way (Explainability)",
    text: "Every response carries an \"Explainability\" link - the groundedness score, the exact prompt sent to the AI, a timing breakdown, and whether the answer came from cache, not a black box.",
    tryHint: "Try it: ask any question, then click \"Explainability\" under the response.",
    learnMoreHref: `${CHATBOT_README}#explainability--what-every-query-response-actually-carries`,
  },
  {
    title: "Grow the knowledge base (RAG ingestion)",
    text: "Every document the chatbot answers from got here the same way: extract the text, split it into chunks, embed, and index - available to the HR Support role.",
    tryHint: "Try it: log in as the sample HR Support persona, upload a PDF under Documents, then come back and ask about what you just added.",
    learnMoreHref: `${CHATBOT_README}#upload-documents-index-them-and-ask-the-knowledge-base`,
  },
];

const HOW_TO_USE_SECTION: FeaturesSection = {
  title: "How to use it",
  paragraphs: [
    "Just type your question like you'd ask a coworker - there's no special format or command to learn.",
    "Not sure what to ask? Click \"Sample queries\" above for more real examples, including multi-step follow-up conversations.",
    "You can keep the conversation going, switch topics, or start a brand new conversation any time with \"+ New conversation.\"",
    "Saw an answer that felt off? Use the thumbs up/down under any response - that feedback is tracked and reviewed, not ignored.",
  ],
};

const WHY_BUILT_SECTION: FeaturesSection = {
  title: "Why this was built",
  paragraphs: [
    "This project exists to show how modern AI - specifically \"RAG\" (retrieval-augmented generation) and AI agents that can take actions, not just answer questions - can make a company's own internal knowledge instantly accessible to employees, instead of sitting locked in documents nobody reads.",
    "It was built hands-on as a learning project, applying real retrieval, conversation-memory, and multi-agent-routing techniques end to end - not just a chat wrapper around a generic AI model.",
  ],
};

const LIMITATIONS_SECTION: FeaturesSection = {
  title: "Good to know (limitations)",
  paragraphs: [
    "\"Amazing Bank\" is a fictional company built for this project - nothing here reflects a real employer's actual policies.",
    "Like any AI system, it can occasionally get something wrong or incomplete. For anything that actually matters, double-check with a real HR contact.",
  ],
};

const CLOSING_SECTION: FeaturesSection = {
  title: "Give it a try",
  paragraphs: [
    "The best way to understand what this can do is to just start asking. Try a simple policy question first, then a follow-up, then something about your own leave balance - see how it handles each one.",
  ],
};

interface ChatbotFeaturesModalProps {
  onClose: () => void;
  onSelect: (query: string) => void;
}

export default function ChatbotFeaturesModal({ onClose, onSelect }: ChatbotFeaturesModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <h2>Chatbot Features</h2>
        <p className="dev-note">A quick overview of what this HR assistant can do, how to use it, and what to keep in mind.</p>

        <div className="modal-section-list">
          <div className="modal-section">
            <h3>{INTRO_SECTION.title}</h3>
            {INTRO_SECTION.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <div className="modal-section">
            <h3>What it can do</h3>
            {CORE_CAPABILITIES.map((capability) => (
              <div key={capability.title} className="feature-capability">
                <p className="feature-capability-title">{capability.title}</p>
                <p>{capability.text}</p>
                {capability.note && <p className="dev-note-inline">{capability.note}</p>}
                {capability.tryQuery && (
                  <ul className="sample-queries-turns">
                    <li>
                      <span className="sample-queries-turn-label">Try</span>
                      <span className="sample-queries-text">{capability.tryQuery}</span>
                      <CopyButton
                        text={capability.tryQuery}
                        label="query"
                        onCopied={() => {
                          onSelect(capability.tryQuery!);
                          onClose();
                        }}
                      />
                    </li>
                  </ul>
                )}
                {capability.tryHint && <p className="dev-note-inline">{capability.tryHint}</p>}
                {capability.learnMoreHref && (
                  <p>
                    <a href={capability.learnMoreHref} target="_blank" rel="noopener noreferrer">
                      Learn more →
                    </a>
                  </p>
                )}
              </div>
            ))}
          </div>

          {[HOW_TO_USE_SECTION, WHY_BUILT_SECTION, LIMITATIONS_SECTION, CLOSING_SECTION].map((section) => (
            <div key={section.title} className="modal-section">
              <h3>{section.title}</h3>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
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
