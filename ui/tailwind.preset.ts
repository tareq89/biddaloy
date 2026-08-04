/**
 * Shared Tailwind preset — the single source of design tokens for every SPA.
 *
 * Deliberately empty at scaffold time: [8.1.2] fills in colour, spacing,
 * radius and typography tokens, including the semantic fee-status tokens that
 * must pair a colour with a non-colour affordance. Shipping the file now means
 * `@beton-boi/ui/tailwind` resolves and apps can wire the import once.
 */
export const betonBoiPreset = {} as const;

export default betonBoiPreset;
