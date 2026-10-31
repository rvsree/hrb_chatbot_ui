import { useEffect, useState } from "react";
import { ApiRequestError, getFinopsCost, getFinopsHistory, getFinopsOtherServices } from "../api/client";
import type { FinopsCostSnapshot, FinopsOtherServiceEntry, FinopsProvider, UserProfile } from "../types";

interface FinopsPanelProps {
  userProfile: UserProfile;
}

type FinopsSubTab = "aws" | "langsmith" | "other-services";

const FINOPS_SUB_TABS: FinopsSubTab[] = ["aws", "langsmith", "other-services"];

const FINOPS_SUB_TAB_LABELS: Record<FinopsSubTab, string> = {
  aws: "AWS",
  langsmith: "LangSmith",
  "other-services": "Other Services",
};

interface FinopsProviderTabProps {
  userProfile: UserProfile;
  provider: FinopsProvider;
  isDollarCost: boolean;
  unavailableMessage: string;
  freeTierNote?: string;
}

// Shared AWS/LangSmith shape - same cost/history calls, only the $ vs.
// trace-count labeling and the unavailable-provider message differ.
function FinopsProviderTab({ userProfile, provider, isDollarCost, unavailableMessage, freeTierNote }: FinopsProviderTabProps) {
  const [snapshot, setSnapshot] = useState<FinopsCostSnapshot | null>(null);
  const [history, setHistory] = useState<FinopsCostSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadCost(forceRefresh: boolean) {
    setCostError(null);
    setIsUnavailable(false);
    try {
      const result = await getFinopsCost(userProfile, provider, forceRefresh);
      setSnapshot(result);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "FINOPS_PROVIDER_UNAVAILABLE") {
        setIsUnavailable(true);
      } else {
        setCostError(err instanceof ApiRequestError ? err.message : "Could not load cost data.");
      }
    }
  }

  async function loadHistory() {
    setHistoryError(null);
    try {
      const result = await getFinopsHistory(userProfile, provider);
      setHistory(result.snapshots);
    } catch (err) {
      setHistoryError(err instanceof ApiRequestError ? err.message : "Could not load cost history.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      setIsLoading(true);
      await Promise.all([loadCost(false), loadHistory()]);
      if (!cancelled) {
        setIsLoading(false);
      }
    }
    initialLoad();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, provider]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await Promise.all([loadCost(true), loadHistory()]);
    setIsRefreshing(false);
  }

  function formatTotal(total: number | null): string {
    if (!isDollarCost) {
      return "usage only - no dollar cost";
    }
    return total !== null ? `$${total.toFixed(2)}` : "-";
  }

  return (
    <div>
      {freeTierNote && <p className="dev-note-inline">{freeTierNote}</p>}

      <button type="button" className="secondary" onClick={handleRefresh} disabled={isRefreshing} style={{ marginBottom: 12 }}>
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>

      {isLoading && <p>Loading...</p>}

      {!isLoading && isUnavailable && <p className="dev-note-inline">{unavailableMessage}</p>}

      {!isLoading && !isUnavailable && costError && <p className="error-banner">{costError}</p>}

      {!isLoading && !isUnavailable && !costError && snapshot && (
        <>
          <p>
            <strong>Current period total:</strong> {formatTotal(snapshot.total_cost)}
          </p>
          <p className="dev-note-inline">
            Period: {snapshot.period_start} to {snapshot.period_end} (captured{" "}
            {new Date(snapshot.captured_at).toLocaleString()})
          </p>
          <div className="documents-table-scroll admin-dashboard-table-scroll">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>{isDollarCost ? "Cost" : "Count"}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(snapshot.cost_breakdown).map(([service, value]) => (
                  <tr key={service}>
                    <td>{service}</td>
                    <td>{isDollarCost ? `$${value.toFixed(2)}` : value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(snapshot.cost_breakdown).length === 0 && (
              <p className="dev-note-inline">No breakdown data in this snapshot.</p>
            )}
          </div>
        </>
      )}

      <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>History</h3>
      {historyError && <p className="error-banner">{historyError}</p>}
      {!isLoading && !historyError && (
        <div className="documents-table-scroll admin-dashboard-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Captured</th>
                <th>Period</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, index) => (
                <tr key={`${entry.captured_at}-${index}`}>
                  <td>{new Date(entry.captured_at).toLocaleString()}</td>
                  <td>
                    {entry.period_start} to {entry.period_end}
                  </td>
                  <td>{formatTotal(entry.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <p className="dev-note-inline">No snapshot history yet.</p>}
        </div>
      )}
    </div>
  );
}

function FinopsOtherServicesTab({ userProfile }: { userProfile: UserProfile }) {
  const [services, setServices] = useState<FinopsOtherServiceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const result = await getFinopsOtherServices(userProfile);
        if (!cancelled) {
          setServices(result.services);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiRequestError ? err.message : "Could not load other services.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  return (
    <div>
      <p className="dev-note-inline">
        No live call here - these 3 already bill near-$0 idle (serverless/PAYG/scale-to-zero), so there's nothing to
        monitor or pause.
      </p>

      {isLoading && <p>Loading...</p>}
      {!isLoading && error && <p className="error-banner">{error}</p>}
      {!isLoading &&
        !error &&
        services.map((service) => (
          <div key={service.provider} className="panel panel-info" style={{ marginBottom: 12 }}>
            <span className="panel-eyebrow">{service.display_name}</span>
            <p>
              <strong>Billing model:</strong> {service.billing_model}
            </p>
            <p>{service.why_no_pause_needed}</p>
          </div>
        ))}
      {!isLoading && !error && services.length === 0 && (
        <p className="dev-note-inline">No other-services data returned.</p>
      )}
    </div>
  );
}

// Phase 20 (hrb_chatbot_service's own Phase 283) - FinOps Monitoring tab:
// AWS/LangSmith cost+history, plus a static "why no pause control" note
// for Pinecone/Upstash(Redis)/Neon. Same self-contained-panel pattern as
// AwsDemoPanel - this tab owns its own fetch/loading/error state, the
// parent dashboard just renders it.
export default function FinopsPanel({ userProfile }: FinopsPanelProps) {
  const [subTab, setSubTab] = useState<FinopsSubTab>("aws");

  return (
    <div>
      <div className="tab-strip tab-strip-nested" style={{ marginBottom: 16 }}>
        {FINOPS_SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={subTab === tab ? "tab-strip-button-active" : "tab-strip-button"}
            onClick={() => setSubTab(tab)}
          >
            {FINOPS_SUB_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {subTab === "aws" && (
        <FinopsProviderTab
          userProfile={userProfile}
          provider="aws"
          isDollarCost
          unavailableMessage="AWS cost data isn't available yet - this needs a Cost Explorer permission the production role doesn't have. Ask the admin to grant it."
        />
      )}
      {subTab === "langsmith" && (
        <FinopsProviderTab
          userProfile={userProfile}
          provider="langsmith"
          isDollarCost={false}
          unavailableMessage="LangSmith usage data isn't available right now."
          freeTierNote="This project is on LangSmith's free Base plan - usage (trace counts) is tracked here, but there's no real dollar cost yet."
        />
      )}
      {subTab === "other-services" && <FinopsOtherServicesTab userProfile={userProfile} />}
    </div>
  );
}
