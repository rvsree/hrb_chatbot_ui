import { useState } from "react";
import { ApiRequestError, getAdminDocContent, listAdminDocs } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import type { AdminDocSummary } from "../types";

interface DocLinkProps {
  featureName: string;
}

// Matches doc_type values written by scripts/sync_admin_docs.py - a
// readable label for the popover, not a value stored anywhere itself.
const DOC_TYPE_LABELS: Record<string, string> = {
  overview: "Overview",
  spec: "Spec",
  architecture: "Architecture",
  design: "Design",
  decisions: "Decisions",
  deck: "Deck",
  faq: "FAQ",
};

// Overview first (it's the entry point), then the rest in reading order -
// the API returns rows in an unspecified tie order, not this one.
const DOC_TYPE_ORDER = ["overview", "spec", "architecture", "design", "decisions", "deck", "faq"];

function docTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? docType;
}

function sortByDocType(docs: AdminDocSummary[]): AdminDocSummary[] {
  return [...docs].sort((a, b) => DOC_TYPE_ORDER.indexOf(a.doc_type) - DOC_TYPE_ORDER.indexOf(b.doc_type));
}

// Phase 170 (round 1) - admin-only link to the in-app architecture docs
// viewer, visible at a handful of UI locations (growing past these 2 is
// future phases' own scope). Renders nothing for a non-admin viewer -
// cheaper and simpler than a hidden-but-present element for a link only
// one role should ever see.
export default function DocLink({ featureName }: DocLinkProps) {
  const { identity } = useIdentity();
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 179 - a feature can now have several docs (Spec/Architecture/
  // Design/Decisions), not just one. null = popover closed.
  const [matches, setMatches] = useState<AdminDocSummary[] | null>(null);

  if (!identity || identity.role !== "admin") {
    return null;
  }
  const currentIdentity = identity;

  async function openDoc(docId: number) {
    setIsOpening(true);
    setError(null);
    // Opened synchronously, inside the click handler's own call stack - a
    // tab opened *after* an awaited fetch loses the browser's "this came
    // from a real click" association, and Chrome silently blocks it (no
    // error, nothing visibly happens). Opening blank first, then
    // redirecting it once the real URL is known, keeps the open() call
    // itself synchronous. Deliberately no "noopener"/"noreferrer" here -
    // either one makes window.open() return null (confirmed live: the
    // tab opened but stayed on about:blank forever, since there was no
    // reference left to redirect) - we need the reference to navigate
    // this tab a moment later, to our own vetted S3 URL, not arbitrary
    // user input, so the reverse-tabnabbing risk those flags guard
    // against doesn't apply the way it would for a third-party link.
    const newTab = window.open("", "_blank");
    try {
      const { download_url } = await getAdminDocContent(currentIdentity, docId);
      if (newTab) {
        newTab.location.href = download_url;
      } else {
        setError("Your browser blocked the new tab - allow pop-ups for this site.");
      }
    } catch (err) {
      newTab?.close();
      setError(err instanceof ApiRequestError ? err.message : "Could not open the doc.");
    } finally {
      setIsOpening(false);
    }
  }

  async function handleClick() {
    if (matches) {
      // Popover already open - clicking the icon again closes it.
      setMatches(null);
      return;
    }
    setIsOpening(true);
    setError(null);
    try {
      const { docs } = await listAdminDocs(currentIdentity);
      const found = docs.filter((candidate) => candidate.feature_name === featureName);
      if (found.length === 0) {
        setError("No doc synced for this feature yet.");
        return;
      }
      if (found.length === 1) {
        await openDoc(found[0].id);
        return;
      }
      setMatches(sortByDocType(found));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not open the doc.");
    } finally {
      setIsOpening(false);
    }
  }

  // Phase 177 - the error used to render as extra inline text next to the
  // icon, which broke layout in a narrow container (the admin dropdown
  // menu, confirmed live - "No doc synced for this feature yet." wrapped
  // across several lines next to a tiny icon). A native tooltip (the
  // button's own title) can never break a parent's layout, so the error
  // lives there instead - never as sibling DOM content.
  const title = error ?? "View architecture doc (admin only)";

  return (
    <span className="doc-link">
      <button
        type="button"
        className={error ? "doc-link-button doc-link-button-error" : "doc-link-button"}
        onClick={handleClick}
        disabled={isOpening}
        aria-label={title}
        title={title}
      >
        {isOpening ? (
          "..."
        ) : (
          <svg viewBox="0 0 16 16" width="9" height="9" fill="none" aria-hidden="true">
            <path
              d="M2 3c1.8-.8 3.6-.8 5.4 0v9c-1.8-.8-3.6-.8-5.4 0V3Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M14 3c-1.8-.8-3.6-.8-5.4 0v9c1.8-.8 3.6-.8 5.4 0V3Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {matches && (
        <div className="doc-link-popover" role="menu">
          {matches.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="doc-link-popover-item"
              role="menuitem"
              onClick={() => {
                setMatches(null);
                void openDoc(doc.id);
              }}
            >
              {docTypeLabel(doc.doc_type)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
