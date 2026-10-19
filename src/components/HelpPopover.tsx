import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 2026-10-18 - the one shared "?" help popover for the whole app, replacing
// 5 different ad-hoc patterns that had grown up independently (Explainability's
// InfoIcon, the RAG Settings/Documents/Admin "chunking-help-button" click
// toggle, DocumentsPage's own confirm popover, and a few bare native `title`
// attributes) - user-directed: click-pinned (not hover/mouse-out-dismissed),
// an explicit close button, and a Copy button, consistently, everywhere.
// Portal-rendered into document.body with a computed, viewport-clamped
// position - escapes a scrollable ancestor's clipping (a real bug confirmed
// live: .modal-card's own overflow-y: auto implicitly clips overflow-x too,
// a CSS spec rule, not a bug in this project's own code).

// 2026-10-19 - widened twice now (360 -> 480 -> 600): user-reported,
// content read as too vertical/cramped. Still clamped to its bounding
// frame in getPopoverBounds() below, so this is a ceiling, not a
// guarantee - a narrow tab panel still shrinks it.
const POPOVER_MAX_WIDTH = 600;
const POPOVER_VIEWPORT_MARGIN = 8;

// 2026-10-19 - user-directed (round 2): within the Explainability modal,
// a popover must stay inside the ACTIVE TAB's own frame
// (.explainability-tab-panel), not just the overall modal
// (.modal-card/.explainability-card) - the modal grew wider (Phase 224's
// Guardrails tab, Phase 225's wider popovers) and clamping to the whole
// modal let a popover opened near a tab's edge sit over the tab-strip
// header or past the scrollable content area. Falls back to .modal-card
// for a popover outside any tab panel (e.g. a modal's own h2-row help
// icon), then the full viewport for the Settings sidebar's popovers
// (not inside a modal at all).
function getPopoverBounds(anchorEl: HTMLElement | null) {
  const boundsEl = anchorEl?.closest<HTMLElement>(".explainability-tab-panel") ?? anchorEl?.closest<HTMLElement>(".modal-card");
  if (boundsEl) {
    return boundsEl.getBoundingClientRect();
  }
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
}

interface HelpPopoverProps {
  label: string;
  children: ReactNode;
  // "muted" matches the old info-icon-unimplemented look (a stub feature,
  // e.g. sql_db_agent) - visually distinct from a real, working one.
  variant?: "default" | "muted";
}

export default function HelpPopover({ label, children, variant = "default" }: HelpPopoverProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    openUpward: boolean;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const isOpen = position !== null;

  function openPopover() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    // 2026-10-18 - user-directed (4th report, with a screenshot): inside a
    // modal, the popover must stay within its own frame, not just
    // "somewhere on screen" - a popup overlapping the darkened backdrop
    // (or, round 2: a neighboring tab's header) reads as broken even
    // though it's technically still fully visible.
    const bounds = getPopoverBounds(buttonRef.current);
    const maxWidth = Math.min(POPOVER_MAX_WIDTH, bounds.right - bounds.left - POPOVER_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(120, bounds.bottom - bounds.top - POPOVER_VIEWPORT_MARGIN * 2);
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(centerX - maxWidth / 2, bounds.left + POPOVER_VIEWPORT_MARGIN),
      bounds.right - maxWidth - POPOVER_VIEWPORT_MARGIN,
    );
    // Provisional guess only - CSS max-height caps the box but says
    // nothing about its REAL rendered height before it mounts, so this
    // can't be the final position. The layout effect below corrects it
    // against the real measured height right after mount.
    const openUpward = rect.top - bounds.top > 220;
    const rawTop = openUpward ? rect.top - 6 : rect.bottom + 6;
    const top = Math.min(Math.max(rawTop, bounds.top + POPOVER_VIEWPORT_MARGIN), bounds.bottom - POPOVER_VIEWPORT_MARGIN);
    setPosition({ top, left, openUpward, maxWidth, maxHeight });
    setCopied(false);
  }

  function closePopover() {
    setPosition(null);
    setCopied(false);
  }

  // 2026-10-19, round 3 - openPopover()'s clamp only bounds the CSS
  // anchor coordinate against a GUESSED direction, before the popover's
  // real height is known (`max-height` is a ceiling, not the actual
  // rendered height). Two real, reported overflow bugs came from this:
  // opening upward could render above the frame's top edge (transform:
  // translateY(-100%) shifts the box up by its own height, never
  // rechecked against the top bound), and opening downward could just as
  // easily render past the frame's BOTTOM edge (nothing ever rechecked
  // `top + height` against the bottom bound at all - the bug in the
  // latest screenshot). Fixed by making this layout effect, which runs
  // after every mount/reposition with the REAL measured height, the only
  // source of truth for the final top/openUpward - it picks whichever
  // side actually has room for the real height (or the bigger side if
  // neither fully fits - maxHeight already guarantees the box itself is
  // never taller than the whole frame), then clamps the anchor so the
  // WHOLE box stays inside bounds on that side. Converges in at most one
  // extra render: the second pass sees the same measured height and
  // computes the same answer, so setPosition is skipped and the effect
  // stops re-running.
  useLayoutEffect(() => {
    if (!position || !contentRef.current || !buttonRef.current) {
      return;
    }
    const bounds = getPopoverBounds(buttonRef.current);
    const rect = buttonRef.current.getBoundingClientRect();
    const actualHeight = contentRef.current.getBoundingClientRect().height;
    const spaceAbove = rect.top - bounds.top;
    const spaceBelow = bounds.bottom - rect.bottom;
    const fitsAbove = spaceAbove >= actualHeight + POPOVER_VIEWPORT_MARGIN;
    const fitsBelow = spaceBelow >= actualHeight + POPOVER_VIEWPORT_MARGIN;
    const openUpward = fitsAbove ? true : fitsBelow ? false : spaceAbove >= spaceBelow;

    const newTop = openUpward
      ? Math.min(Math.max(rect.top - 6, bounds.top + actualHeight + POPOVER_VIEWPORT_MARGIN), bounds.bottom - POPOVER_VIEWPORT_MARGIN)
      : Math.min(Math.max(rect.bottom + 6, bounds.top + POPOVER_VIEWPORT_MARGIN), bounds.bottom - actualHeight - POPOVER_VIEWPORT_MARGIN);

    if (newTop !== position.top || openUpward !== position.openUpward) {
      setPosition((prev) => (prev ? { ...prev, top: newTop, openUpward } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.top, position?.openUpward, position?.left]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      closePopover();
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePopover();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function copyContent() {
    const text = contentRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard API can be refused (older desktop apps, some webviews) -
      // fall back to selecting the text so the user can still Ctrl+C it.
      const selection = window.getSelection();
      if (contentRef.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  return (
    <span className="help-popover-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={variant === "muted" ? "help-popover-trigger help-popover-trigger-muted" : "help-popover-trigger"}
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => (isOpen ? closePopover() : openPopover())}
      >
        ?
      </button>
      {isOpen &&
        position &&
        createPortal(
          <div
            ref={contentRef}
            className="help-popover"
            role="dialog"
            aria-label={label}
            style={{
              top: position.top,
              left: position.left,
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
              transform: position.openUpward ? "translateY(-100%)" : undefined,
            }}
          >
            <div className="help-popover-header">
              <strong>{label}</strong>
              <button type="button" className="help-popover-close" aria-label="Close" onClick={closePopover}>
                ×
              </button>
            </div>
            <div className="help-popover-body">{children}</div>
            <div className="help-popover-footer">
              {/* 2026-10-19 - user-requested: icon instead of the word
                  "Copy", with the label moved to a hover tooltip (native
                  `title`) instead of always-visible text. */}
              <button
                type="button"
                className="help-popover-copy"
                onClick={copyContent}
                title={copied ? "Copied" : "Copy content"}
                aria-label={copied ? "Copied" : "Copy content"}
              >
                {copied ? (
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3 8.5L6.2 12 13 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="5.5" y="5.5" width="8" height="9" rx="1.3" />
                    <path d="M3.5 10.5v-7a1.3 1.3 0 0 1 1.3-1.3h6" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
