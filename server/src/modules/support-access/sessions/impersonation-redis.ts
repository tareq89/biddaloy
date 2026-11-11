/** [99.2.01] Injection token of the fail-fast Redis client for Login as. #3797 registers the provider. */
export const IMPERSONATION_REDIS = 'IMPERSONATION_REDIS';

/** The live session a `JwtStrategy` reads: `imp:<sid>` holds an `ImpersonationLiveSession` JSON. */
export const impKey = (sid: string) => `imp:${sid}`;

/** One-time exchange code (#3790); `hash` is the code's hash, never the code. */
export const codeKey = (hash: string) => `imp:code:${hash}`;

/** Start counter of one platform admin: at most 10 starts an hour. */
export const rateKey = (adminId: string) => `imp:rate:${adminId}`;
