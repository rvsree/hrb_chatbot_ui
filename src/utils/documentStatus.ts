// Shared between UploadPage.tsx's live per-file list and DocumentsPage.tsx's
// grid - one place for "what does this backend status string mean to a
// human," since both pages show the same underlying document.status values.
// Phase 134 (backend): the real stage sequence is now downloading ->
// parsing -> chunking -> embedding -> indexing -> indexed/failed, and a
// failure's error_message is prefixed "[<stage>] " with the stage it
// actually failed at - statusLabel() surfaces that as "Error - <Stage>"
// instead of a bare "Failed" with no context.

const STAGE_LABELS: Record<string, string> = {
  requesting_url: "Uploading",
  uploading: "Uploading",
  pending_upload: "Queued",
  downloading: "Downloading",
  parsing: "Parsing",
  chunking: "Chunking",
  embedding: "Embedding",
  indexing: "Indexing",
  indexed: "Indexed",
  failed: "Failed",
  timed_out: "Still processing",
  uploaded: "Uploaded",
  duplicate: "Duplicate",
  rejected: "Rejected",
  reindexed: "Re-indexed",
  unchanged: "Unchanged",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

const STAGE_PREFIX = /^\[([a-z_]+)\]/;

// errorMessage: pass the document's error_message when status is "failed" -
// omit it (or pass null/undefined) for every other status.
export function statusLabel(status: string, errorMessage?: string | null): string {
  if (status === "failed" && errorMessage) {
    const match = errorMessage.match(STAGE_PREFIX);
    if (match) {
      return `Error - ${stageLabel(match[1])}`;
    }
  }
  return stageLabel(status);
}

export function formatElapsed(milliseconds: number): string {
  if (milliseconds < 0) {
    return "—";
  }
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
