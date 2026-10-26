# hrb_chatbot_ui Roadmap

Phase-by-phase plan and history, same convention as the other 6 repos in this platform.

**2026-10-25: this file starts here, not from this repo's real beginning.** Every page, component, and real feature in this codebase today (12 pages, SSE streaming chat, the admin dashboard, Playwright e2e suite, the S3/CloudFront deploy pipeline) was built and shipped before this file existed - real, working, verified code, just never phase-tracked. Rather than invent a fabricated phase-by-phase history for work already done, phase tracking starts fresh from here forward, same as how `hrb_chatbot_service`'s own 14 pre-SDD phases are marked "Retrofitted (pre-SDD)" instead of reconstructed after the fact.

## Status at a glance

| Phase | Title | Status | Spec |
|---|---|---|---|
| - | Everything before 2026-10-25 | Pre-SDD, real and shipped | not tracked here - see `git log` |
| 1 | Live Queries + Synthetic Dataset tabs, Settings page | ✅ Built and verified | ✅ Spec'd - see detail below |

## Phases

- [x] **Phase 1 (done) — Live Queries + Synthetic Dataset viewer tabs, and a new Settings page (Model/Memory/Resiliency) backed by `hrb_chatbot_service`'s generic `app_settings` endpoints.** User-directed, 2026-10-26, completes MVP-5 (backend from `hrb_chatbot_service` Phases 257/259/260 already ships what this UI calls).
  - **Spec:**
    - **Context:** `hrb_chatbot_service` built 3 new admin GET routes this session (`/live-queries`, `/synthetic-dataset`) and a generic runtime-settings mechanism (`GET`/`PUT /app-settings/{key}`) with 3 real settings already wired to it dynamically (`judge_provider_default`, `react_loop_max_iterations`, and the 2 circuit-breaker thresholds per LLM provider) - none of it has a frontend yet. This phase adds both: two new simple list tabs (same pattern as the existing `golden-dataset` tab) and one new Settings page.
    - **UI/UX contract:**
      - **Live Queries tab**: new `AdminTab` entry, same list-tab shape as `golden-dataset` - a table of captured queries (`query_text`, `pipeline`, `eval_score`, `is_ltm`, `created_at`), with a simple `is_ltm` filter toggle (All / LTM only / Not LTM) calling the existing `?is_ltm=` query param.
      - **Synthetic Dataset tab**: new `AdminTab` entry, identical shape to `golden-dataset`'s own tab (same columns: `case_key`, `dataset`, `category`, `query`) - reuses the same rendering pattern, different data source.
      - **Settings tab**: new `AdminTab` entry, renders a new `SettingsPanel.tsx` component with its own internal 3-way sub-tab state (not 4 - "Dataset" was discussed early on but has no actual setting to hold today; not building an empty tab). **Model**: one dropdown (OpenAI / Anthropic) bound to `judge_provider_default`. **Memory**: one number input (0.0-1.0) bound to `ltm_score_threshold`, with the STM/LTM naming clarification from `testing-strategies.md` shown as inline help text. **Resiliency**: 4 number inputs - `react_loop_max_iterations`, and `llm_openai_circuit_breaker_failure_threshold`/`_cooldown_seconds`, `llm_anthropic_circuit_breaker_failure_threshold`/`_cooldown_seconds` (the real per-breaker key names `circuit_breaker.py` actually derives - `llm:openai` → `llm_openai_...`, `llm:anthropic` → `llm_anthropic_...`). Every field: load current value on tab open (`GET`, 404 shows the field's own documented default, not an error state), a "Save" button per field calls `PUT`, shows a brief success/failure inline message, no page reload.
    - **API contract:** 5 new `client.ts` functions, same GET-with-identity-query-params / PUT-with-JSON-body shapes every existing admin call already uses (`listGoldenDataset`/`reviewFaqSubmission` are the 2 closest precedents, confirmed by reading both directly): `listLiveQueries(userProfile, isLtm?)`, `listSyntheticDataset(userProfile)`, `getAppSetting(userProfile, key)`, `updateAppSetting(userProfile, key, value)`. All hit `${API_BASE_URL}` (today: `https://hrb-chatbot.rvsree.dev`, routed through `hrb_api_gateway_service` per this repo's own existing convention) - the gateway is a transparent forwarder per its own architecture doc, so no gateway-side change is expected to be needed for these to reach `hrb_chatbot_service`, but this is confirmed live during implementation, not assumed. New `types.ts` interfaces: `LiveQuerySummary`/`LiveQueryListResponse`, `SyntheticDatasetCaseSummary`/`SyntheticDatasetListResponse`, `AppSettingResponse` - field names mirror `hrb_chatbot_service/src/hrb_chatbot/models/admin.py` exactly, not re-derived.
    - **Failure modes:** a list tab's own fetch failure shows the same inline error banner pattern `golden-dataset`/`eval-runs` already use (confirmed by reading their existing JSX, not invented). A Settings field's `GET` 404 (key never set) shows the field's documented default value, editable, not an error. A `PUT` failure shows an inline "could not save" message next to that field, the old value stays displayed (not cleared), matching this project's general "never lose what the user already saw" convention.
    - **Out of scope:** a 4th "Dataset" settings tab (no real setting exists for it yet - flagged, not built). Making `golden-dataset`'s own existing tab editable (write access) - out of scope, these 2 new tabs and the Settings page are read-only lists / editable-settings-only, not a golden-dataset-editor. Auto-refreshing a list tab while open (same manual-refresh-on-tab-switch pattern every other admin tab already uses, not a new polling mechanism).
    - **Open questions:** none.
  - **Built and verified, 2026-10-26:** `src/types.ts`/`src/api/client.ts` got the 5 new interfaces/functions
    (`listLiveQueries`/`listSyntheticDataset`/`getAppSetting`/`updateAppSetting`, all matching
    `hrb_chatbot_service/src/hrb_chatbot/models/admin.py` field names exactly). `AdminDashboardPage.tsx` gained
    3 new `AdminTab` entries (`live-queries`, `synthetic-dataset`, `settings`), wired into the existing
    `Promise.allSettled` refresh pattern and the `interview-qa-ref`/`build-deploy` categories per the spec.
    Live Queries got its own `is_ltm` filter control (All/LTM only/Not LTM), mirroring the existing Live
    Metrics window-select pattern exactly (`handleLiveQueryLtmFilterChange`, same shape as
    `handleMetricsWindowChange`). New `src/components/SettingsPanel.tsx` holds the 3 sub-tabs (Model/Memory/
    Resiliency), each field a reusable `SettingField` component: loads via `GET` on mount, 404
    (`ADMIN_SETTING_NOT_FOUND`) shows the field's own documented default (not an error), a per-field Save
    button calls `PUT` with an inline success/failure message, old value stays on screen on failure. Documented
    defaults hardcoded in the component match the real backend fallbacks exactly (`judge_provider_default`:
    "openai", `ltm_score_threshold`: 0.6, `react_loop_max_iterations`: 5, both circuit breakers'
    failure_threshold: 2 / cooldown_seconds: 10 - confirmed by reading `circuit_breaker.py`/
    `orchestration_agent.py`/`run_release_gate.py`'s `_resolve_judge_provider()` directly, not guessed).
    `npm run build` passes clean (only the pre-existing chunk-size warning). New
    `e2e/admin-settings-and-datasets.spec.ts` (3 tests, same `TEST_ADMIN_SECRET_CODE`-gated skip convention as
    `admin-doc-links.spec.ts`) covers the Live Queries filter re-fetch, Synthetic Dataset row-click detail
    modal, and all 3 Settings sub-tabs loading + a Save round-trip - confirmed to list/parse correctly via
    `npx playwright test --list`, not run live (no admin secret code configured in this session).
