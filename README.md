# HRB Chatbot UI

React + TypeScript + Vite frontend for `hrb_chatbot_v2` (a separate repo,
deliberately - see `hrb_chatbot_v2/docs/dev-reference/deployment-guide/
07-reactjs-ui.html`). Deploys to S3 + CloudFront, not App Runner - its own
build/deploy pipeline, decoupled from the backend's.

## Setup

```
npm install
cp .env.example .env   # defaults to the live backend at hrb-chatbot.rvsree.dev
npm run dev
```

## What's real vs. mocked in this first phase

Built against `hrb_chatbot_v2`'s actual API contracts, not invented ones -
see that repo's `docs/dev-reference/ui-wireframes-review.html` and
`docs/agent-reference/BACKLOG.md`'s "UI backend-gap findings" section for
the full audit. Three things the backend doesn't support yet, so they're
clearly labeled rather than faked:

- **Login** is a dev-only form collecting `employee_id`/`full_name`/`role`
  - the same fields the API already reads from `user_profile` on every
    request. No real OAuth/JWT exists on the backend yet.
- **Conversation history** lives in `localStorage` only (one browser, one
  device) - the backend has no `GET` endpoint for it, only `DELETE`.
- **Feedback** ("Helpful"/"Not quite") and the **explainability** popup's
  cost/token/latency/call-trace fields aren't persisted or returned by any
  endpoint yet - feedback logs to the console, explainability shows real
  model/citation data and labels the rest "not available yet."

Real and working: asking a question (`POST /v1/genai-rag/retrieve-document/
query`), citations, and document upload for `hr_support`-role users
(`POST /v1/genai-rag/ingest-document/documents`).
