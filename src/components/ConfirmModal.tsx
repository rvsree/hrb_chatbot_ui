// Phase 143: replaces window.confirm() wherever a destructive action needs
// confirmation - a native confirm() can't be restyled, retitled away from
// "<host> says", or made consistent with the rest of this app's look,
// which is exactly what got reported across document delete, bulk delete,
// and conversation delete (chunking-strategy's own confirmation got a
// different, anchored-to-cell treatment in Phase 142 - this is the
// centered-modal version for actions with no single grid cell to anchor
// to, like bulk delete or a sidebar conversation entry).
interface ConfirmModalProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, detail, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        {detail && <pre className="llm-context-pre">{detail}</pre>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
