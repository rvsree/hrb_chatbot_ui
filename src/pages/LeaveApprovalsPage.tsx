import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, listAllLeaveRequests } from "../api/client";
import DocLink from "../components/DocLink";
import LeaveReviewModal from "../components/LeaveReviewModal";
import { useIdentity } from "../context/IdentityContext";
import { LEAVE_TYPE_LABELS, type HrLeaveRequestSummary, type LeaveTypeCode } from "../types";

// Phase 168 (round 2) - a grid, not a card list: every leave request
// across every employee, any status (so past approvals/rejections stay
// visible, not just the still-open ones /pending used to show).
// Clicking a row opens LeaveReviewModal - a popup, like the employee
// side's own "Request Unpaid Leave" - instead of an inline form on the
// page itself.
export default function LeaveApprovalsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<HrLeaveRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<HrLeaveRequestSummary | null>(null);

  useEffect(() => {
    if (!identity || (identity.role !== "hr_support" && identity.role !== "admin")) {
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  if (!identity) {
    navigate("/login");
    return null;
  }
  const currentIdentity: typeof identity = identity;

  if (currentIdentity.role !== "hr_support" && currentIdentity.role !== "admin") {
    return (
      <div className="centered-page">
        <div className="card">
          <h1>Leave approvals</h1>
          <p>Only HR Support and Admin can review leave requests - the backend rejects any other role.</p>
          <p>
            <Link to="/chat">Back to chat</Link>
          </p>
        </div>
      </div>
    );
  }

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listAllLeaveRequests(currentIdentity);
      setRequests(response.requests);
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.message} (${err.code})` : "Something went wrong reaching the backend.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="card documents-card">
        <h1>
          Leave approvals <DocLink featureName="request-unpaid-leave" />
        </h1>
        <p>
          <Link to="/chat">Back to chat</Link> · <Link to="/upload">Upload documents</Link> ·{" "}
          <Link to="/documents">Manage documents</Link> · <Link to="/feedback">View feedback</Link>
        </p>
        <p className="dev-note">
          Every specialist-reviewed leave request - pending, approved, and rejected. Click a row to review or see
          the outcome.
        </p>

        {isLoading && <p>Loading...</p>}
        {error && <p className="error-banner">{error}</p>}
        {!isLoading && requests.length === 0 && !error && <p>No leave requests.</p>}

        {requests.length > 0 && (
          <div className="documents-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Employee</th>
                  <th>Leave type</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr
                    key={request.hitl_request_context_id}
                    onClick={() => setSelectedRequest(request)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>#{request.hitl_request_context_id}</td>
                    <td>
                      {request.employee_name ?? "unknown"} ({request.employee_id ?? "unknown"})
                    </td>
                    <td>{LEAVE_TYPE_LABELS[request.leave_type as LeaveTypeCode] ?? request.leave_type}</td>
                    <td>
                      {request.start_date} to {request.end_date} ({request.days}d)
                    </td>
                    <td>{request.status}</td>
                    <td>{request.decision ?? "-"}</td>
                    <td>{request.created_at ? new Date(request.created_at).toLocaleDateString() : "unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRequest && (
        <LeaveReviewModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onResolved={() => {
            setSelectedRequest(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
