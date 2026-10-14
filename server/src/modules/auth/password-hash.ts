import * as bcrypt from 'bcrypt';

/** The one bcrypt cost for every password hash the server creates. */
export const BCRYPT_COST = 12;
/** bcrypt only reads the first 72 bytes of a password; longer new passwords are refused. */
export const BCRYPT_MAX_BYTES = 72;

/**
 * Compare target when no user is found, so login / step-up / social sign-in
 * always pay bcrypt's cost (otherwise "no such user" returns near-instantly —
 * a timing oracle for enumerating identifiers). Precomputed (hashing at import
 * blocked every process for ~250 ms); `password-hash.spec.ts` asserts its cost
 * equals BCRYPT_COST. The hash of 'never-a-real-password', never a real one.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$fL1KMZrg/xnNYKUWBx5eYu2/vceduZUeGNjWRRAZdhIL7Rj7MnElu';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);

/** True for a stored hash cheaper than the current cost (upgraded on the next good sign-in). */
export const needsRehash = (hash: string): boolean => bcrypt.getRounds(hash) < BCRYPT_COST;

/**
 * Extra bcrypt costs to run after checking a cost-`rounds` hash so the total
 * work equals one BCRYPT_COST check. Each cost step doubles the work, so
 * t(r) + t(r) + t(r+1) + … + t(BCRYPT_COST − 1) = t(BCRYPT_COST).
 */
export const padCosts = (rounds: number): number[] => {
  const costs: number[] = [];
  for (let cost = rounds; cost < BCRYPT_COST; cost++) costs.push(cost);
  return costs;
};

/**
 * The one password check. Always costs the same as one BCRYPT_COST compare,
 * whatever is stored:
 * - no hash (unknown user / passwordless account) → compare against the dummy hash, false;
 * - a legacy cheaper hash (cost 10 until its owner signs in again) → padded with
 *   throw-away hashes up to BCRYPT_COST, so a dormant real account is not faster
 *   than an unknown identifier (a user-enumeration timing oracle otherwise).
 */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) {
    await bcrypt.compare(plain, DUMMY_PASSWORD_HASH);
    return false;
  }
  const ok = await bcrypt.compare(plain, stored);
  let rounds = BCRYPT_COST;
  try {
    rounds = bcrypt.getRounds(stored);
  } catch {
    // Malformed stored hash: compare already returned false; nothing to pad.
  }
  // Sequential on purpose: run in parallel on the libuv pool they would finish early.
  for (const cost of padCosts(rounds)) await bcrypt.hash(plain, cost);
  return ok;
}
