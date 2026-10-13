import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, listMyLeaveRequests } from "../api/client";
import { useIdentity } from "../context/IdentityContext";
import { LEAVE_TYPE_LABELS, type LeaveTypeCode, type MyLeaveRequestSummary } from "../types";

// Phase 165 - closes the "no way for an employee to learn the outcome"
// gap: a read-only view of the caller's own specialist-reviewed leave
// requests, complementing the email notification (Phase 165 also added),
// not replacing it - an employee can check here any time, not just when
// an email happens to arrive.
export default function MyLeaveRequestsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<MyLeaveRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      return;
    }
    listMyLeaveRequests(identity)
      .then((response) => setRequests(response.requests))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? `${err.message} (${err.code})` : "Something went wrong reaching the backend.");
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  if (!identity) {
    navigate("/login");
    return null;
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>My leave requests</h1>
        <p>
          <Link to="/chat">Back to chat</Link>
        </p>
        <p className="dev-note">Unpaid Leave, Critical CareGiver, STD, and LTD requests you've submitted.</p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}
        {!isLoading && requests.length === 0 && !error && <p>You haven't submitted any requests yet.</p>}

        {requests.map((request) => (
          <div key={request.request_id} className="panel panel-info" style={{ marginTop: 14 }}>
            <span className="panel-eyebrow">
              Request #{request.request_id} · {LEAVE_TYPE_LABELS[request.leave_type as LeaveTypeCode] ?? request.leave_type} ·{" "}
              {request.status}
              {request.decision && ` · ${request.decision}`}
            </span>
            <ul className="citation-list">
              <li>
                Dates: {request.start_date} to {request.end_date} ({request.days} day(s))
              </li>
              <li>Purpose: {request.purpose}</li>
              <li>Submitted: {request.created_at ? new Date(request.created_at).toLocaleString() : "unknown"}</li>
              {request.responded_at && (
                <li>
                  Reviewed: {new Date(request.responded_at).toLocaleString()}
                  {request.hr_specialist_name && ` by ${request.hr_specialist_name}`}
                </li>
              )}
              {request.hr_comments && <li>Specialist comments: {request.hr_comments}</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
