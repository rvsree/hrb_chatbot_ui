import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiRequestError,
  getLeaveDocumentUploadUrl,
  listMyLeaveRequests,
  submitUnpaidLeaveRequest,
  uploadFileToS3,
} from "../api/client";
import DocLink from "./DocLink";
import { useIdentity } from "../context/IdentityContext";
import { LEAVE_TYPE_LABELS, type LeaveTypeCode, type MyLeaveRequestSummary } from "../types";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx"];

interface UnpaidLeaveModalProps {
  onClose: () => void;
}

interface FieldErrors {
  startDate?: string;
  endDate?: string;
  purpose?: string;
  file?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Client-side validation mirrors the backend's own real constraints (end >=
// start, a non-empty purpose) plus a few checks the backend doesn't need to
// repeat (empty-field prompts, a sane file type/size) - the backend is still
// the real source of truth, this just avoids a round trip for the obvious cases.
function validate(startDate: string, endDate: string, purpose: string, file: File | null): FieldErrors {
  const errors: FieldErrors = {};
  if (!startDate) {
    errors.startDate = "Pick a start date.";
  }
  if (!endDate) {
    errors.endDate = "Pick an end date.";
  } else if (startDate && endDate < startDate) {
    errors.endDate = "End date can't be before the start date.";
  }
  if (!purpose.trim()) {
    errors.purpose = "Tell us the reason for this leave.";
  } else if (purpose.trim().length > 2000) {
    errors.purpose = "Keep the reason under 2000 characters.";
  }
  if (file) {
    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      errors.file = "Only .pdf or .docx files are accepted.";
    } else if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.file = "File is too large - 10MB limit.";
    }
  }
  return errors;
}

export default function UnpaidLeaveModal({ onClose }: UnpaidLeaveModalProps) {
  const { identity } = useIdentity();
  const [leaveTypeCode, setLeaveTypeCode] = useState<LeaveTypeCode>("UNPAID");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Phase 165 (follow-up) - the user asked that this popup itself show
  // earlier requests + their HR status/comments when it opens, not just a
  // blank submission form - "maintain state... whenever an employee
  // logs in." Loaded once on open; refreshed again after a successful
  // submit below, rather than merged piecemeal.
  const [priorRequests, setPriorRequests] = useState<MyLeaveRequestSummary[]>([]);
  const [isLoadingPrior, setIsLoadingPrior] = useState(true);

  useEffect(() => {
    if (!identity) {
      return;
    }
    loadPriorRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  async function loadPriorRequests() {
    if (!identity) {
      return;
    }
    setIsLoadingPrior(true);
    try {
      const response = await listMyLeaveRequests(identity);
      setPriorRequests(response.requests);
    } catch {
      // Best-effort - the submission form still works if this fails.
    } finally {
      setIsLoadingPrior(false);
    }
  }

  async function handleSubmit() {
    if (!identity) {
      return;
    }
    const errors = validate(startDate, endDate, purpose, file);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      let documentReference: string | undefined;
      if (file) {
        const contentType = file.type || "application/octet-stream";
        const presigned = await getLeaveDocumentUploadUrl(identity, file.name, contentType);
        await uploadFileToS3(presigned.upload_url, file, contentType);
        documentReference = presigned.key;
      }

      await submitUnpaidLeaveRequest(identity, startDate, endDate, purpose.trim(), leaveTypeCode, documentReference);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof ApiRequestError ? error.message : "Something went wrong reaching the backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>
          Request Unpaid Leave <DocLink featureName="request-unpaid-leave" />
        </h2>
        <p className="dev-note-inline">
          Reviewed by the HR specialist team, not your manager - these leave types always go through specialist
          review. <Link to="/my-leave-requests">My requests</Link>
        </p>

        {!isLoadingPrior && priorRequests.length > 0 && (
          <>
            <label>Your requests</label>
            <div className="citation-list" style={{ maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
              {priorRequests.map((request) => (
                <div key={request.request_id} className="panel panel-info" style={{ marginBottom: 8 }}>
                  <span className="panel-eyebrow">
                    {LEAVE_TYPE_LABELS[request.leave_type as LeaveTypeCode] ?? request.leave_type} · {request.status}
                    {request.decision && ` · ${request.decision}`}
                  </span>
                  <p className="dev-note-inline">
                    {request.start_date} to {request.end_date} ({request.days} day(s))
                  </p>
                  {request.hr_comments && (
                    <p className="dev-note-inline">
                      HR comments{request.hr_specialist_name ? ` from ${request.hr_specialist_name}` : ""}:{" "}
                      {request.hr_comments}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <label htmlFor="unpaid-leave-type">Leave type</label>
        <select
          id="unpaid-leave-type"
          value={leaveTypeCode}
          onChange={(event) => setLeaveTypeCode(event.target.value as LeaveTypeCode)}
          disabled={isSubmitting}
        >
          {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label htmlFor="unpaid-leave-start-date">Start date</label>
        <input
          id="unpaid-leave-start-date"
          type="date"
          min={todayIso()}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          disabled={isSubmitting}
        />
        {fieldErrors.startDate && <p className="leave-form-error">{fieldErrors.startDate}</p>}

        <label htmlFor="unpaid-leave-end-date">End date</label>
        <input
          id="unpaid-leave-end-date"
          type="date"
          min={startDate || todayIso()}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          disabled={isSubmitting}
        />
        {fieldErrors.endDate && <p className="leave-form-error">{fieldErrors.endDate}</p>}

        <label htmlFor="unpaid-leave-purpose">Purpose</label>
        <textarea
          id="unpaid-leave-purpose"
          rows={3}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          placeholder="Why are you requesting unpaid leave?"
          disabled={isSubmitting}
        />
        {fieldErrors.purpose && <p className="leave-form-error">{fieldErrors.purpose}</p>}

        <label htmlFor="unpaid-leave-document">Supporting document (optional)</label>
        <input
          id="unpaid-leave-document"
          type="file"
          accept=".pdf,.docx"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={isSubmitting}
        />
        {fieldErrors.file && <p className="leave-form-error">{fieldErrors.file}</p>}

        {submitError && <p className="error-banner">{submitError}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
