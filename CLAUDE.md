# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

React + TypeScript + Vite frontend for the HRB benefits chatbot platform. Talks to `hrb_api_gateway_service` (a separate repo - the real public entry point), never to a backend directly in production. Deploys to S3 + CloudFront, not App Runner - its own build/deploy pipeline, fully decoupled from every backend service's own.

**2026-10-25: first Claude Code session on this repo with the full SDD setup** (`.claude/`, this file, `ROADMAP.md`). Everything built before today is real, shipped, working code - just never phase-tracked the way the other 6 repos in this platform are. `ROADMAP.md`'s own "Status at a glance" table says so explicitly rather than inventing a fake phase history for it.

## Commands

```bash
npm install            # once, or after package.json changes
npm run dev             # dev server, http://localhost:5173
npm run build            # tsc -b && vite build - type-check, then bundle
npm run lint              # oxlint
npm run preview            # serve the production build locally
npm run e2e                 # playwright test - real browser, real backend calls
```

No `.env` committed - `cp .env.example .env` for local dev (`.env.example` already points at the live production Gateway, so this works with zero editing). `.env.production` (committed, no secrets) is what the real deployed build uses.

## Architecture

### Request flow

Every page talks to the backend through exactly one place: `src/api/client.ts` - a single fetch wrapper, `VITE_API_BASE_URL` baked in at build time (not read at runtime). No page calls `fetch()` directly. `VITE_API_BASE_URL`'s own fallback default (used only if the env var is unset) still points at `hrb_chatbot_service` directly, not the Gateway - a dev-time convenience, not what the real production build uses.

### Source layout

- `src/pages/` - 12 real pages: `ChatPage` (4 modes, SSE streaming), `AdminDashboardPage` (CI/CD dashboard, golden dataset, eval runs, architecture docs viewer), `DocumentsPage`/`UploadPage` (KB management), `LeaveApprovalsPage`/`MyLeaveRequestsPage`, `LoginPage`, `FaqPage`/`FaqReviewPage`/`ViewFeedbackPage`/`OpenDocPage`/`ResetSecretCodePage`.
- `src/api/` - the one API client.
- `src/components/` - shared UI components.
- `src/context/` - React context providers (identity/session).
- `src/storage/` - `localStorage` wrappers - session identity and remembered settings only, never state that must persist reliably or be shared between viewers.
- `src/constants/`, `src/utils/` - as named.

### Testing

`e2e/` - real Playwright specs driving the live/local UI in a real browser, not mocked. `admin-doc-links.spec.ts` and `golden-dataset-conversational.spec.ts` (multi-turn conversations through the real chat UI, `TEST_BASE_URL` env var switches target between local and production) are the two that exist today.

## Docs worth reading before non-trivial changes

- [platform-overview.html](https://github.com/rvsree/hrb_emp_assist/blob/master/docs/architecture/platform-overview.html) *(in the shared `hrb_emp_assist` repo, moved there 2026-10-26 - not duplicated here)* - the cross-service hub.
- [hrb-chatbot-ui-current-state-architecture.drawio](https://github.com/rvsree/hrb_emp_assist/blob/master/docs/architecture/diagrams/hrb-chatbot-ui-current-state-architecture.drawio) - the real page/API-client structure, one diagram.
- `ROADMAP.md` - this repo's own phase history, going forward from 2026-10-25.

## Spec-Driven Development (SDD)

Same convention as the other 6 repos in this platform: a spec is a `**Spec:**` block written into a phase's own bullet in `ROADMAP.md`'s `## Phases` section, before that phase's code starts - see `.claude/skills/spec-new/SKILL.md`.

**Four working norms, same as every other repo in this platform:**
- **One task at a time.** No multi-file autonomous changes across unrelated concerns.
- **Flag, don't fix.** Something noticed outside the current task's scope gets a one-line note in the delivery note, not an unprompted fix.
- **Nothing gets pushed/deployed without the user's own local review and explicit go-ahead first.** Implement and self-verify locally (including a real `npm run build` and `npm run e2e` where relevant), then stop and wait for confirmation before `git push` or anything that changes what's live.
- **Docs stay in sync with reality.** A design/architecture change gets reflected in the relevant doc (in `hrb_chatbot_service`'s shared doc tree) before the work is considered done.

**Hooks** (`.claude/settings.json`): `PreToolUse` (`.claude/scripts/spec_gate.py`) blocks a `Write`/`Edit` under `src/**` (`.ts`/`.tsx` files only) unless `ROADMAP.md` has at least one `- [ ]` phase with a written `**Spec:**` block. Scoped to `src/**` only, deliberately - never `.claude/`, `e2e/`, or `docs/` - so a bug in the gate itself can never lock out fixing it.
