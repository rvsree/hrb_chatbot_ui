# Implement a spec'd phase

Execute one phase from `ROADMAP.md` that already has a written `**Spec:**`
block. Stay inside that spec's declared scope.

## Steps

1. Read the phase's `**Spec:**` block in full.
2. Implement under `src/`, keeping the one-API-client convention
   (`src/api/client.ts` is the only place that calls `fetch()`) and the
   existing page/component structure.
3. Write tests - a real Playwright spec under `e2e/` for anything
   user-facing, matching this project's existing real-browser-against-a-
   real-backend testing pattern (no component-level mocking framework in
   use here).
4. Run `npm run build` (real type-check, catches more than `tsc` alone
   would miss) and, if the phase touches user-facing behavior, `npm run e2e`.
5. Flip the phase's checkbox to `- [x]` only after both pass.
6. Produce a delivery note (`/delivery-note`).
