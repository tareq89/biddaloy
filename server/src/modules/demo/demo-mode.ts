/** True only for the public demo deployment (`DEMO_MODE=true`). Everything else is untouched. */
export const isDemoMode = (): boolean => process.env.DEMO_MODE === 'true';
