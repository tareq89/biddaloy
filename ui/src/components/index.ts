/**
 * Public component surface — one wrapper per vendored primitive. SPAs import from here and never reach into `primitives/`.
 *
 * `Placeholder` exists only to prove the `@beton-boi/ui` import boundary
 * works end to end for [8.1.4]'s scaffold check. Real components arrive with
 * the shadcn/ui wrappers in [8.1.3] and epic 8.6 — delete `Placeholder` once
 * something real is available to prove the boundary instead.
 */
export { Placeholder } from './placeholder';
