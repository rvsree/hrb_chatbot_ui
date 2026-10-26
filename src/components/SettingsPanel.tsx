import { useEffect, useState } from "react";
import { ApiRequestError, getAppSetting, updateAppSetting } from "../api/client";
import type { UserProfile } from "../types";

interface SettingsPanelProps {
  userProfile: UserProfile;
}

type SettingsSubTab = "model" | "memory" | "resiliency";

const SUB_TAB_LABELS: Record<SettingsSubTab, string> = {
  model: "Model",
  memory: "Memory",
  resiliency: "Resiliency",
};

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
function SettingField({ userProfile, settingKey, label, helpText, kind, options, min, max, step }: SettingFieldProps) {
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

// Phase 1 - MVP-5's Settings page: runtime-editable knobs backed by
// hrb_chatbot_service's generic app_settings mechanism (Phase 257/260),
// no redeploy needed for any of these to take effect. "Dataset" was
// discussed early on as a possible 4th sub-tab but has no real setting
// to hold today - not built (flagged, not in scope).
export default function SettingsPanel({ userProfile }: SettingsPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>("model");

  return (
    <div>
      <p className="dev-note-inline">
        Runtime settings backed by hrb_chatbot_service's generic <code>app_settings</code> store. Changes take effect
        on the next request - no redeploy needed.
      </p>
      <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 20 }}>
        {(Object.keys(SUB_TAB_LABELS) as SettingsSubTab[]).map((subTab) => (
          <button
            key={subTab}
            type="button"
            className={activeSubTab === subTab ? undefined : "secondary"}
            onClick={() => setActiveSubTab(subTab)}
          >
            {SUB_TAB_LABELS[subTab]}
          </button>
        ))}
      </div>

      {activeSubTab === "model" && (
        <SettingField
          userProfile={userProfile}
          settingKey="judge_provider_default"
          label="DeepEval judge provider"
          helpText="Which LLM provider scores golden/release-gate cases (groundedness, completeness, relevancy, etc)."
          kind="select"
          options={[
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
          ]}
        />
      )}

      {activeSubTab === "memory" && (
        <SettingField
          userProfile={userProfile}
          settingKey="ltm_score_threshold"
          label="LTM score threshold"
          helpText={
            "Live queries scoring at or above this groundedness threshold (0.0-1.0) get promoted to " +
            "is_ltm = true - a curated pool of real-world questions the system already answers well. " +
            "This is distinct from the existing conversation_store, which saves every turn regardless of score."
          }
          kind="number"
          min={0}
          max={1}
          step={0.05}
        />
      )}

      {activeSubTab === "resiliency" && (
        <>
          <SettingField
            userProfile={userProfile}
            settingKey="react_loop_max_iterations"
            label="ReAct loop max iterations"
            helpText="single-agentic-rag's own tool-calling loop cap, per request."
            kind="number"
            min={1}
            step={1}
          />
          <SettingField
            userProfile={userProfile}
            settingKey="llm_openai_circuit_breaker_failure_threshold"
            label="OpenAI circuit breaker - failure threshold"
            helpText="Consecutive OpenAI call failures, within the cooldown window below, before the breaker trips."
            kind="number"
            min={1}
            step={1}
          />
          <SettingField
            userProfile={userProfile}
            settingKey="llm_openai_circuit_breaker_cooldown_seconds"
            label="OpenAI circuit breaker - cooldown seconds"
            helpText="How long the breaker stays open (failing fast) once tripped, before allowing one retry."
            kind="number"
            min={1}
            step={1}
          />
          <SettingField
            userProfile={userProfile}
            settingKey="llm_anthropic_circuit_breaker_failure_threshold"
            label="Anthropic circuit breaker - failure threshold"
            helpText="Consecutive Anthropic call failures, within the cooldown window below, before the breaker trips."
            kind="number"
            min={1}
            step={1}
          />
          <SettingField
            userProfile={userProfile}
            settingKey="llm_anthropic_circuit_breaker_cooldown_seconds"
            label="Anthropic circuit breaker - cooldown seconds"
            helpText="How long the breaker stays open (failing fast) once tripped, before allowing one retry."
            kind="number"
            min={1}
            step={1}
          />
        </>
      )}
    </div>
  );
}
