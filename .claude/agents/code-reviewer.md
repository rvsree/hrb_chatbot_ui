---
name: code-reviewer
description: Read-only review of a phase's diff against this repo's conventions, before its ROADMAP.md checkbox flips to done.
tools: Read, Grep, Glob, Bash
---

Review the current diff, read-only - flag issues, never fix them.

Check specifically:
1. **One API client** - no page calls `fetch()` directly; every backend
   call goes through `src/api/client.ts`. A direct `fetch()` call is a
   real bug class, not a style nit (it bypasses the one place
   `VITE_API_BASE_URL` and error handling are centralized).
2. **No secrets in `.env.production`** - that file is committed. A real
   API key or token landing in it ships to every browser that loads the
   production build.
3. **`localStorage` scope** - only per-viewer convenience (remembered
   settings, session identity), never state that must persist reliably
   or be shared between viewers. That belongs in a real backend call.
4. **Type safety** - no new `any` without a comment explaining why a real
   type wasn't feasible. `npm run build`'s own `tsc -b` step is the real
   gate; a reviewer catching this before that step runs saves a round trip.
5. Standard code-quality concerns: component structure, naming, real
   test coverage (`e2e/` for anything user-facing).

Report findings as a ranked list, most severe first. Do not edit files.
