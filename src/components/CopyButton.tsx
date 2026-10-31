import { useState, type MouseEvent } from "react";

// 2026-10-18 - user-directed: copy-to-clipboard for every past query/
// response, not just "?" popovers. Phase 4 - extracted out of
// MessageBubble.tsx (where this started) into its own file so Golden
// Dataset/Synthetic Dataset's own query columns can reuse the exact same
// component instead of a second copy of the same logic.
export default function CopyButton({
  text,
  label = "content",
  onCopied,
}: {
  text: string;
  label?: string;
  // Phase 18 - the login page's sample-credentials hint also fills the
  // matching form field on a successful copy, not just the clipboard.
  // Optional, every other call site is unaffected.
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent) {
    // Stops a copy click inside a clickable table row from also opening
    // that row's own detail modal.
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopied?.();
    } catch {
      // Clipboard API can be refused (older desktop apps, some webviews) -
      // nothing to fall back to here (no stable DOM node to select from) -
      // fail quietly rather than break the page.
    }
  }

  // 2026-10-19 - user-requested: icon instead of the word "Copy", label
  // moved to a hover tooltip (native `title`) instead of always-visible text.
  return (
    <button
      type="button"
      className="link-button icon-button"
      onClick={handleCopy}
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={copied ? "Copied" : `Copy ${label}`}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 8.5L6.2 12 13 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="5.5" y="5.5" width="8" height="9" rx="1.3" />
          <path d="M3.5 10.5v-7a1.3 1.3 0 0 1 1.3-1.3h6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
