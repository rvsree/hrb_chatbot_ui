import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, listPublishedFaqs, submitFaqQuestion } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { PublishedFaq } from "../types";

// Phase 186 - any authenticated role can submit a question (gets a real-
// time tool-using LLM first-pass answer immediately) and browse already-
// published FAQs. The review/restructure workflow is a separate page
// (FaqReviewPage.tsx), reachable only by HR Support/Admin.
export default function FaqPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [publishedFaqs, setPublishedFaqs] = useState<PublishedFaq[]>([]);
  const [isLoadingFaqs, setIsLoadingFaqs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      return;
    }
    listPublishedFaqs(identity)
      .then((result) => setPublishedFaqs(result.faqs))
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Could not load published FAQs."))
      .finally(() => setIsLoadingFaqs(false));
  }, [identity]);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    setLastAnswer(null);
    try {
      const result = await submitFaqQuestion(currentIdentity, query.trim());
      setLastAnswer(result.external_llm_answer ?? "Your question was saved - a first-pass answer couldn't be generated right now, but HR will still review it.");
      setQuery("");
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : "Something went wrong reaching the backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>FAQs</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
        </p>
        <p className="dev-note">
          Didn't find your answer in chat? Submit it here - you'll get a real-time first-pass answer immediately,
          and HR may add it to the published FAQs below after review.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask a question that wasn't well answered elsewhere..."
            rows={3}
            disabled={isSubmitting}
          />
          <button type="submit" disabled={!query.trim() || isSubmitting} style={{ alignSelf: "flex-start" }}>
            {isSubmitting ? "Asking..." : "Submit question"}
          </button>
          {submitError && <p className="error-banner">{submitError}</p>}
          {lastAnswer && (
            <div className="chunking-help-popover" style={{ position: "static" }}>
              <p>
                <strong>First-pass answer:</strong> {lastAnswer}
              </p>
            </div>
          )}
        </form>

        <h2 style={{ fontSize: 16 }}>Published FAQs</h2>
        {isLoadingFaqs && <p>Loading...</p>}
        {loadError && <p className="error-banner">{loadError}</p>}
        {!isLoadingFaqs && publishedFaqs.length === 0 && !loadError && <p className="dev-note-inline">No published FAQs yet.</p>}
        <ul className="citation-list">
          {publishedFaqs.map((faq) => (
            <li key={faq.id}>
              <strong>{faq.query}</strong>
              <br />
              {faq.final_answer}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
