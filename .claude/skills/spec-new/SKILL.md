# Write a new spec

A spec is a `**Spec:**` block written into the target phase's own bullet
in `ROADMAP.md`'s `## Phases` section, **before** that phase's code starts.

## Steps

1. Find the target phase's `- [ ]` bullet in `ROADMAP.md`'s `## Phases` section.
2. Append a nested `**Spec:**` sub-list:

   ```
   - **Spec:**
     - **Context:** why this phase, what triggered it.
     - **UI/UX contract** (if this phase touches a page or component):
       what the user sees/does differently after this phase - a real
       before/after, not just "improve X".
     - **API contract** (if this phase touches `src/api/client.ts`):
       confirm the shape against `hrb_api_gateway_service`'s own
       request/response contracts doc - never invent a new shape here.
     - **Failure modes:** what's expected to go wrong, what the user sees
       for each (error banner text, not just a console error).
     - **Out of scope:** what this phase deliberately does not do.
     - **Open questions:** anything needing a decision before/during implementation.
   ```

3. Set the phase's checkbox to `- [ ]` if not already.
4. No implementation code in this step - report the spec for review first.
