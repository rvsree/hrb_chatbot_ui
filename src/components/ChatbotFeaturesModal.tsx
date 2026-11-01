import CopyButton from "./CopyButton";

// Phase 30 - "Chatbot Features" link, right below "Sample queries" -
// same purpose (help a visitor understand what they're looking at) but
// as an intro/overview instead of clickable examples.
//
// Phase 33 - rewritten as a proper product overview, not a literal
// transcript of the original ask: "What is this?"/"What it can do" read
// as the request's own words pasted back, not drafted copy, so section
// names are now Overview/Key Capabilities/Getting Started/Good to Know,
// each its own framed card (.feature-section-card) with real spacing
// between them, instead of a flat, tightly-packed paragraph list. Wider
// shell (.modal-card-xwide, this component only - SampleQueriesModal
// keeps .modal-card-wide, unchanged) gives the capability cards room to
// breathe. "Why this was built" folded into Overview (2 short paragraphs,
// not a separate section); "Give it a try" is now a one-line closing
// callout, not a 6th titled section competing with the 4 real ones.
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
  learnMoreHref?: string;
}

const PLATFORM_README = "https://github.com/rvsree/hrb_emp_assist/blob/master/README.md";
const CHATBOT_README = "https://github.com/rvsree/hrb_chatbot_service/blob/master/README.md";

const OVERVIEW_SECTION: FeaturesSection = {
  title: "Overview",
  paragraphs: [
    "Amazing Bank's AI-powered HR assistant - ask about your 401(k), health plan, PTO, tuition assistance, disability coverage, or leave policy in plain English, and get a straight answer immediately, grounded in the company's real benefits documents, not guessed or invented.",
    "Built end-to-end with modern retrieval-augmented generation (RAG) and AI agents, as a hands-on demonstration of how AI can make an organization's own knowledge instantly accessible to its people, instead of sitting locked in documents nobody reads.",
  ],
  learnMoreHref: `${PLATFORM_README}#what-this-platform-actually-does`,
};

// Each of these is something a visitor logged in here can actually go do,
// in roughly the order they'd naturally meet them in a conversation.
const CORE_CAPABILITIES: CoreCapability[] = [
  {
    title: "Ask a policy question",
    text: "Get an answer grounded in Amazing Bank's actual benefits documents, retrieved from the knowledge base in real time - not guessed or made up.",
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
    title: "Request unpaid leave - reviewed by a real person",
    text: "The chatbot hands this off to a real HR Support identity, who reviews and resolves it - you're emailed the outcome, and the conversation picks back up where it left off.",
    tryHint: "Try it: click \"Request Leave\" to the left of the message box.",
    learnMoreHref: `${CHATBOT_README}#leave-requests-human-in-the-loop-approval`,
  },
  {
    title: "Ask about a file you attach",
    text: "Attach a PDF, Word doc, or CSV right in the chat and ask about just that file - answered from it directly, for this conversation only, not added to the shared knowledge base.",
    tryHint: "Try it: attach a document with the paperclip icon, then ask \"Summarize this document.\"",
  },
  {
    title: "See why it answered that way",
    text: "Every response carries an \"Explainability\" link - the groundedness score, the exact prompt sent to the AI, a timing breakdown, and whether the answer came from cache, not a black box.",
    tryHint: "Try it: ask any question, then click \"Explainability\" under the response.",
    learnMoreHref: `${CHATBOT_README}#explainability--what-every-query-response-actually-carries`,
  },
  {
    title: "Grow the knowledge base",
    text: "Every document the chatbot answers from got here the same way: extract the text, split it into chunks, embed, and index - available to the HR Support role.",
    tryHint: "Try it: log in as the sample HR Support persona, upload a PDF under Documents, then come back and ask about what you just added.",
    learnMoreHref: `${CHATBOT_README}#upload-documents-index-them-and-ask-the-knowledge-base`,
  },
];

const GETTING_STARTED_SECTION: FeaturesSection = {
  title: "Getting Started",
  paragraphs: [
    "Just type your question like you'd ask a coworker - there's no special format or command to learn.",
    "Not sure what to ask? Click \"Sample queries\" above for more real examples, including multi-step follow-up conversations.",
    "Keep the conversation going, switch topics, or start a brand new conversation any time with \"+ New conversation.\"",
    "Saw an answer that felt off? Use the thumbs up/down under any response - that feedback is tracked and reviewed, not ignored.",
  ],
};

const GOOD_TO_KNOW_SECTION: FeaturesSection = {
  title: "Good to Know",
  paragraphs: [
    "\"Amazing Bank\" is a fictional company built for this project - nothing here reflects a real employer's actual policies.",
    "Like any AI system, it can occasionally get something wrong or incomplete. For anything that actually matters, double-check with a real HR contact.",
  ],
};

const CLOSING_LINE =
  "Ready to explore? Start with a simple policy question, then try a follow-up, then ask about your own leave balance.";

interface ChatbotFeaturesModalProps {
  onClose: () => void;
  onSelect: (query: string) => void;
}

function renderSection(section: FeaturesSection) {
  return (
    <div key={section.title} className="feature-section-card">
      <h3>{section.title}</h3>
      {section.paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
      {section.learnMoreHref && (
        <p>
          <a href={section.learnMoreHref} target="_blank" rel="noopener noreferrer">
            Learn more →
          </a>
        </p>
      )}
    </div>
  );
}

export default function ChatbotFeaturesModal({ onClose, onSelect }: ChatbotFeaturesModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-xwide" onClick={(event) => event.stopPropagation()}>
        <h2>Chatbot Features</h2>
        <p className="dev-note">A closer look at what this AI assistant can do, how to get the most out of it, and what to keep in mind.</p>

        <div className="feature-sections">
          {renderSection(OVERVIEW_SECTION)}

          <div className="feature-section-card">
            <h3>Key Capabilities</h3>
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

          {renderSection(GETTING_STARTED_SECTION)}
          {renderSection(GOOD_TO_KNOW_SECTION)}
        </div>

        <p className="feature-cta">{CLOSING_LINE}</p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
