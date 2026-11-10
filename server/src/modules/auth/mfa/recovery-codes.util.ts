import { randomInt } from 'crypto';
import { hashSecret } from '../token-hash.util';

// No 0/O/1/I/l: easy to misread when typed from paper.
export const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LEN = 4;

function oneCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let part = '';
    for (let i = 0; i < GROUP_LEN; i++)
      part += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    groups.push(part);
  }
  return groups.join('-');
}

export function generateCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(oneCode());
  return [...codes];
}

/** Lower-cases, drops spaces and dashes, regroups: `ABCD-efgh jkmn-pqrs` matches `abcd-efgh-jkmn-pqrs`. */
export function normalise(input: string): string {
  const flat = input.toLowerCase().replace(/[\s-]/g, '');
  if (flat.length !== GROUPS * GROUP_LEN) return flat;
  return flat.match(/.{4}/g)!.join('-');
}

export function hashCode(input: string): string {
  return hashSecret(normalise(input));
}
