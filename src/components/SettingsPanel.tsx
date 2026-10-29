import { useEffect, useState } from "react";
import { ApiRequestError, getAppSetting, updateAppSetting } from "../api/client";
import type { UserProfile } from "../types";

// Phase 1 - the field's own documented default, shown when GET 404s
// (key never set in app_settings) - matches each setting's real
// hardcoded fallback in hrb_chatbot_service's own source, not guessed:
// judge_provider_default (run_release_gate.py's _resolve_judge_provider),
// ltm_score_threshold (eval_threshold.py), react_loop_max_iterations
// (orchestration_agent.py's DEFAULT_MAX_ITERATIONS), and the 4 circuit
// breaker keys (common/resiliency/circuit_breaker.py's own fallbacks).
const DOCUMENTED_DEFAULTS: Record<string, number | string> = {
  judge_provider_default: "openai",
  ltm_score_threshold: 0.6,
  react_loop_max_iterations: 5,
  llm_openai_circuit_breaker_failure_threshold: 2,
  llm_openai_circuit_breaker_cooldown_seconds: 10,
  llm_anthropic_circuit_breaker_failure_threshold: 2,
  llm_anthropic_circuit_breaker_cooldown_seconds: 10,
};

interface SettingFieldProps {
  userProfile: UserProfile;
  settingKey: string;
  label: string;
  helpText?: string;
  kind: "number" | "select";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

// One field: loads its current value on mount (404 -> documented
// default, not an error), has its own Save button, and its own inline
// success/failure message - a PUT failure leaves the old value on
// screen rather than clearing it, matching this project's general
// "never lose what the user already saw" convention.
//
// 2026-10-29 - moved out of its own Admin Dashboard "Settings" tab into
// the main chat UI's own Settings modal (ChatPage.tsx, gear icon,
// admin-only gated there) - user-directed, this is a reusable field
// building block, not a full panel, so only SettingField itself is
// exported now; the old default-exported tabbed wrapper is gone.
export function SettingField({ userProfile, settingKey, label, helpText, kind, options, min, max, step }: SettingFieldProps) {
  const [value, setValue] = useState<string>(String(DOCUMENTED_DEFAULTS[settingKey] ?? ""));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getAppSetting(userProfile, settingKey);
        if (!cancelled) {
          setValue(String(result.value));
        }
      } catch (error) {
        if (!cancelled && !(error instanceof ApiRequestError && error.code === "ADMIN_SETTING_NOT_FOUND")) {
          setMessage("Could not load this setting - showing its documented default.");
          setMessageIsError(true);
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
  }, [userProfile, settingKey]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    try {
      const parsedValue = kind === "number" ? Number(value) : value;
      await updateAppSetting(userProfile, settingKey, parsedValue);
      setMessage("Saved.");
      setMessageIsError(false);
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : "Could not save this setting.");
      setMessageIsError(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <label htmlFor={`setting-${settingKey}`} style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </label>
      {helpText && <p className="dev-note-inline">{helpText}</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        {kind === "select" ? (
          <select
            id={`setting-${settingKey}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={isLoading || isSaving}
          >
            {options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`setting-${settingKey}`}
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => setValue(event.target.value)}
            disabled={isLoading || isSaving}
          />
        )}
        <button type="button" onClick={handleSave} disabled={isLoading || isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
      {message && <p className={messageIsError ? "error-banner" : "dev-note-inline"}>{message}</p>}
    </div>
  );
}

