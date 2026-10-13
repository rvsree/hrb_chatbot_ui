import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiRequestError, getAdminDocContent, listAdminDocs } from "../api/client";
import { useIdentity } from "../context/IdentityContext";

// Phase 180 (round 7) - the real fix for cross-document links inside the
// admin docs themselves (Spec linking to Architecture, etc.). A static
// <a href="architecture.html"> inside a presigned-S3-delivered file can
// never work: the signature in the query string is dropped on relative
// resolution (confirmed via urljoin()), and the bucket blocks all public
// access - there's no static-HTML fix. This route is the real fix instead:
// the documents link here (an absolute URL into this app, not into S3),
// and this page does what DocLink already does on every click - ask the
// authenticated API for a fresh presigned URL, then redirect to it.
export default function OpenDocPage() {
  const { identity } = useIdentity();
  const [searchParams] = useSearchParams();
  const [fetchError, setFetchError] = useState<string | null>(null);
  const feature = searchParams.get("feature");
  const docType = searchParams.get("type");

  // Derived during render, not set via an effect - these don't depend on
  // anything async, so there's no reason to synchronize them through state.
  const validationError =
    !identity || identity.role !== "admin"
      ? "Only an admin login can open this document."
      : !feature || !docType
        ? "This link is missing which document to open."
        : null;
  const error = validationError ?? fetchError;

  useEffect(() => {
    if (validationError || !identity || !feature || !docType) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { docs } = await listAdminDocs(identity);
        const doc = docs.find((candidate) => candidate.feature_name === feature && candidate.doc_type === docType);
        if (!doc) {
          if (!cancelled) {
            setFetchError(`No "${docType}" doc synced for "${feature}" yet.`);
          }
          return;
        }
        const { download_url } = await getAdminDocContent(identity, doc.id);
        if (!cancelled) {
          window.location.replace(download_url);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof ApiRequestError ? err.message : "Could not open the document.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, feature, docType, validationError]);

  if (!identity) {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Sign in required</h1>
          <p>Log in as admin to open this document.</p>
          <a href="/login">Go to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="centered-page">
      <div className="card">
        <h1>{error ? "Could not open document" : "Opening document…"}</h1>
        {error ? <p className="error-banner">{error}</p> : <p>Redirecting to the latest version.</p>}
      </div>
    </div>
  );
}
