# HRB Chatbot UI

React + TypeScript + Vite frontend for `hrb_chatbot_v2` (a separate repo,
deliberately - see `hrb_chatbot_v2/docs/dev-reference/deployment-guide/
07-reactjs-ui.html`). Deploys to S3 + CloudFront, not App Runner - its own
build/deploy pipeline, decoupled from the backend's.

## Environments

| App | Local | AWS (production) |
| --- | --- | --- |
| Frontend (this repo) | `http://localhost:5173` (`npm run dev`) | `https://hrb-chatbot-ui.rvsree.dev` |
| Backend (`hrb_chatbot_v2`, separate repo) | `http://127.0.0.1:8093` | `https://hrb-chatbot.rvsree.dev` |
| MCP server (`hrb_lms_mcp`, separate repo - leave balance/history tools, called by the backend, not by this frontend directly) | `http://127.0.0.1:8190` | `https://hrb-lms-mcp.rvsree.dev` |

Local dev (`.env`, gitignored) points at whatever `VITE_API_BASE_URL` you
set - `.env.example` defaults it to the production backend, so a fresh
`cp .env.example .env` works with no editing. The production build
(`.env.production`, committed - no secrets in it) always targets the
production backend regardless of your local `.env`. The AWS frontend is a
static `npm run build` output synced to an S3 bucket (`hrb-chatbot-ui-
rvsree`) behind a CloudFront distribution with a Route53 alias - provisioned
manually via the AWS CLI (2026-10-07), no CI/CD pipeline for it yet (a real
upfront cost this repo's own deployment-guide doc already flagged - see the
link above).

## Running this project (first time, step by step)

If you're coming from ASP.NET: there's no single "project file" to open or
run. You run small commands in a terminal, and they read config files
automatically - closer to running `dotnet watch run` from a terminal than
pressing F5 in Visual Studio.

1. **Open a terminal in VS Code.** Menu bar -> Terminal -> New Terminal (or
   `` Ctrl+` ``). Make sure it's sitting in this project's folder (the
   prompt should show `hrb_chatbot_ui`).
2. **Install dependencies (first time only, like `dotnet restore`):**
   ```
   npm install
   ```
   This reads `package.json` (closest equivalent: a `.csproj` plus its
   NuGet package list, combined) and downloads everything into
   `node_modules/` (gitignored, like a `bin/`/`obj/` folder - never commit
   it, never worry about its contents).
3. **Create your local config (first time only, like copying
   `appsettings.json` to `appsettings.Development.json`):**
   ```
   cp .env.example .env
   ```
   `.env` isn't committed to git - it's your machine's own settings. The
   default already points at the live AWS backend, so this works with no
   editing.
4. **Start the dev server:**
   ```
   npm run dev
   ```
   This is the closest thing to pressing F5: it starts a local web server
   and keeps running in that terminal (like IIS Express staying open while
   you debug). It prints a URL - something like `http://localhost:5173/`.
5. **Open that URL in Chrome.** That's the app. Every time you save a
   file, the open page updates itself automatically (no restart needed -
   this is "hot reload", there's no real equivalent in classic ASP.NET).
6. **To stop it:** click into that terminal and press `Ctrl+C`.

**If `npm run dev` says the port is already in use:** something else
(maybe a previous run that didn't get stopped cleanly) is still listening
on 5173. Close that old terminal, or just use a different port:
`npm run dev -- --port 5174` and open that port instead.

**What each file actually is**, mapped to ASP.NET terms:

| This project | Closest ASP.NET equivalent |
| --- | --- |
| `package.json` | `.csproj` + NuGet package list, combined |
| `package.json`'s `"scripts"` section | the commands `npm run <name>` actually runs - e.g. `npm run dev` runs `vite` |
| `vite.config.ts` | dev-server/startup config (port, plugins) |
| `tsconfig.json` | compiler settings (target framework, language version) |
| `.env` | `appsettings.Development.json` |
| `src/main.tsx` | `Program.cs` - the real entry point |
| `src/App.tsx` | where routes are registered - `Startup.cs`'s `UseEndpoints` |
| `node_modules/` | `bin/`/`obj/` - generated, gitignored, ignore it |

**When something breaks in the browser:** open Chrome DevTools (`F12`),
click the **Console** tab, and either screenshot it or copy the red error
text - that's the most useful thing to paste back for help, more useful
than describing what the screen looked like.

## What's real vs. mocked

Built against `hrb_chatbot_v2`'s actual API contracts, not invented ones -
see that repo's `docs/dev-reference/ui-wireframes-review.html` for the
original audit. Updated 2026-10-07 - two of the three gaps that audit found
have since been closed:

- **Login** validates `employee_id`/`full_name`/`role` against a small
  fixed roster on the backend (`POST /v1/auth/login`, Phase 106) - denies
  an unknown identity instead of accepting anything typed into the form.
  Still not real OAuth/JWT - once signed in, role is self-asserted on
  every later request, same as before.
- **Conversation history** is real now: `GET /v1/conversations` (own list)
  and `GET /v1/conversations/{id}` (one conversation's turns) both exist
  (Phase 116) - `ChatPage.tsx` lazy-loads from these on login and merges
  them into local state, not `localStorage`-only anymore.
- **Feedback** ("Helpful"/"Not quite") is persisted for real
  (`POST`/`GET /v1/feedback`, Phase 104) - `ViewFeedbackPage.tsx` (route
  `/feedback`) lists it back out. The **explainability** popup's
  cost-in-dollars field is still the one real gap left - token/latency/
  cache-vs-live/eval-score fields are all real, cost is explicitly
  excluded (tracked in `hrb_chatbot_v2`'s own `BACKLOG.md`).

Real and working: asking a question (`POST /v1/genai-rag-retrieval/query`),
citations, and document upload for `hr_support`-role users
(`POST /v1/genai-rag/ingest-document/documents`).
