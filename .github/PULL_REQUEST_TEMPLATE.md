## Summary

<!-- What changed, and the reasoning behind any non-obvious call. -->

Closes #

## Test plan

- [ ] `yarn build`
- [ ] `yarn lint`
- [ ] `yarn test:unit`
- [ ] Manual verification against real infrastructure (Postgres/Redis, a
      real browser), where applicable

### If this PR touches `ui/`

`yarn test:unit` above is the server's own suite and doesn't run
frontend tests — this section's `yarn test:frontend:coverage` is
additional, not a replacement. See
[`ui/CONTRIBUTING.md`](../ui/CONTRIBUTING.md#pr-checklist) for the
full component contribution checklist — the wrapper rule, the three-file
requirement, accessibility, token usage, and i18n expectations. In short:

- [ ] Every new/changed component ships all three files (`.tsx` +
      `.stories.tsx` + `.test.tsx`).
- [ ] The wrapper does more than pass props through, or says explicitly
      why it doesn't yet.
- [ ] `await expect(container).toHaveNoViolations()` passes, including
      error/invalid states.
- [ ] Keyboard-operable.
- [ ] No hardcoded colour — role tokens only.
- [ ] `yarn test:frontend:coverage` (from the **repo root**) passes.

## Notes

<!-- Deviations from the linked issue's literal text, accepted tradeoffs, follow-ups. -->
