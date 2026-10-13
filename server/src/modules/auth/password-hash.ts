import * as bcrypt from 'bcrypt';

/** The one bcrypt cost for every password hash the server creates. */
export const BCRYPT_COST = 12;
/** bcrypt only reads the first 72 bytes of a password; longer new passwords are refused. */
export const BCRYPT_MAX_BYTES = 72;

/**
 * Compare target when no user is found, so login / step-up / social sign-in
 * always pay bcrypt's cost (otherwise "no such user" returns near-instantly —
 * a timing oracle for enumerating identifiers). Computed once at boot so its
 * cost always equals BCRYPT_COST. Never the hash of a real password.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('never-a-real-password', BCRYPT_COST);

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);

/** True for a stored hash cheaper than the current cost (upgraded on the next good sign-in). */
export const needsRehash = (hash: string): boolean => bcrypt.getRounds(hash) < BCRYPT_COST;
