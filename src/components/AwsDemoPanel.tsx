import { useEffect, useRef, useState } from "react";
import { ApiRequestError, getAwsDemoStatus, pauseAwsDemoServices, resumeAwsDemoServices } from "../api/client";
import type { AwsDemoServiceStatus, UserProfile } from "../types";

interface AwsDemoPanelProps {
  userProfile: UserProfile;
}

// Phase 261 - "AWS Demo" Settings tab: manual Start/Pause/Status control
// over this platform's own 6 App Runner services, the button-triggered
// half of the "LightSwitch"-style FinOps pattern (Phase 262's scheduled
// idle-timeout auto-pause is the other half, no UI surface of its own).
//
// Resume/pause are asynchronous on AWS's own side - clicking a button
// shows OPERATION_IN_PROGRESS immediately, not the final RUNNING/PAUSED
// state, so this polls status every 5s while anything is still in
// progress and stops once everything's settled, same self-rescheduling
// pattern the CI/CD Pipeline tab's own polling already uses.
export default function AwsDemoPanel({ userProfile }: AwsDemoPanelProps) {
  const [services, setServices] = useState<AwsDemoServiceStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 261 - per-service "this one button is mid-click" state, so a
  // slow Resume on one service doesn't gray out buttons for the other 5.
  const [actingOn, setActingOn] = useState<Set<string>>(new Set());
  const pollTimeoutRef = useRef<number | undefined>(undefined);

  async function fetchStatus() {
    try {
      const result = await getAwsDemoStatus(userProfile);
      setServices(result.services);
      setError(null);
      return result.services;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load AWS Demo status.");
      return [];
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      setIsLoading(true);
      await fetchStatus();
      if (!cancelled) {
        setIsLoading(false);
      }
    }
    initialLoad();

    return () => {
      cancelled = true;
      if (pollTimeoutRef.current !== undefined) {
        window.clearTimeout(pollTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  function scheduleNextPoll(currentServices: AwsDemoServiceStatus[]) {
    if (pollTimeoutRef.current !== undefined) {
      window.clearTimeout(pollTimeoutRef.current);
    }
    const stillSettling = currentServices.some((service) => service.status === "OPERATION_IN_PROGRESS");
    if (!stillSettling) {
      return;
    }
    pollTimeoutRef.current = window.setTimeout(async () => {
      const refreshed = await fetchStatus();
      scheduleNextPoll(refreshed);
    }, 5000);
  }

  async function handleAction(serviceName: string, action: "resume" | "pause") {
    setActingOn((prev) => new Set(prev).add(serviceName));
    setError(null);
    try {
      const caller = action === "resume" ? resumeAwsDemoServices : pauseAwsDemoServices;
      const result = await caller(userProfile, [serviceName]);
      // Merge the one updated service's result into the existing list -
      // the other 5 services' last-known status stays shown rather than
      // being cleared while this one action is in flight. Computed once
      // as a local value so both the state update and the poll scheduler
      // use the same real merged list, not a stale closure over the
      // previous `services` state.
      const mergedServices = services.map((service) => {
        const updated = result.services.find((s) => s.service_name === service.service_name);
        return updated ?? service;
      });
      setServices(mergedServices);
      scheduleNextPoll(mergedServices);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `Could not ${action} ${serviceName}.`);
    } finally {
      setActingOn((prev) => {
        const next = new Set(prev);
        next.delete(serviceName);
        return next;
      });
    }
  }

  async function handleRefresh() {
    setIsLoading(true);
    await fetchStatus();
    setIsLoading(false);
  }

  function statusBadgeClass(status: string): string {
    if (status === "RUNNING") return "status-badge status-success";
    if (status === "PAUSED") return "status-badge status-paused";
    if (status === "OPERATION_IN_PROGRESS") return "status-badge status-queued";
    return "status-badge status-error"; // ERROR, or anything else AWS returns that isn't one of the 3 expected states
  }

  return (
    <div>
      <p className="dev-note-inline">
        Manual Start/Pause/Status control over this platform's own App Runner services - the LightSwitch-style
        pattern, button-triggered. All 6 services pause by default to control AWS cost; resuming one for a demo keeps
        it running until paused again (or Phase 262's scheduled idle-timeout auto-pause, once built).
      </p>

      <button type="button" onClick={handleRefresh} disabled={isLoading} style={{ marginBottom: 16 }}>
        {isLoading ? "Refreshing..." : "Refresh"}
      </button>

      {error && <p className="error-banner">{error}</p>}

      {isLoading && services.length === 0 && <p>Loading...</p>}

      {services.length > 0 && (
        <div className="documents-table-scroll admin-dashboard-table-scroll">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>URL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const isActing = actingOn.has(service.service_name);
                const isBusy = isActing || service.status === "OPERATION_IN_PROGRESS";
                return (
                  <tr key={service.service_name}>
                    <td>{service.display_name}</td>
                    <td>
                      <span className={statusBadgeClass(service.status)}>{service.status}</span>
                      {service.error && <p className="error-banner">{service.error}</p>}
                    </td>
                    <td>
                      {service.url ? (
                        <a href={service.url} target="_blank" rel="noreferrer">
                          {service.url}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleAction(service.service_name, "resume")}
                        disabled={isBusy || service.status === "RUNNING"}
                        style={{ marginRight: 8 }}
                      >
                        {isActing ? "..." : "Resume"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleAction(service.service_name, "pause")}
                        disabled={isBusy || service.status === "PAUSED"}
                      >
                        {isActing ? "..." : "Pause"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && services.length === 0 && !error && (
        <p className="dev-note-inline">No services configured (AWS_DEMO_SERVICES not set on the backend).</p>
      )}
    </div>
  );
}
