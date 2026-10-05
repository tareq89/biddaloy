import { UserRole } from '../enums/index';

export type PasswordAudience = 'staff' | 'family';
export type PasswordRuleId = 'minLength' | 'upper' | 'lower' | 'digit' | 'special';

const STAFF_RULES: PasswordRuleId[] = ['minLength', 'upper', 'lower', 'digit', 'special'];
const FAMILY_RULES: PasswordRuleId[] = ['minLength', 'digit'];

/** D7: one minimum for every password path (the server's DTOs import it too). */
export const PASSWORD_MIN_LENGTH = 8;

const TESTS: Record<PasswordRuleId, (p: string) => boolean> = {
  minLength: (p) => p.length >= PASSWORD_MIN_LENGTH,
  upper: (p) => /[A-Z]/.test(p),
  lower: (p) => /[a-z]/.test(p),
  digit: (p) => /[0-9০-৯]/.test(p),
  // A symbol: anything that is not a letter (any script), a digit or a space.
  // Bangla letters are letters, not symbols. Upper/lower stay ASCII on purpose:
  // Bangla has no case, so a staff password needs some Latin letters.
  special: (p) => /[^\p{L}\p{N}\s]/u.test(p),
};

export function passwordRulesFor(audience: PasswordAudience): PasswordRuleId[] {
  return [...(audience === 'family' ? FAMILY_RULES : STAFF_RULES)];
}

export function checkPassword(
  password: string,
  audience: PasswordAudience,
): { id: PasswordRuleId; ok: boolean }[] {
  return passwordRulesFor(audience).map((id) => ({ id, ok: TESTS[id](password) }));
}

/** 'family' only when every role is PARENT or STUDENT; empty list = 'staff' (strictest wins). */
export function audienceForRoles(roles: UserRole[]): PasswordAudience {
  return roles.length > 0 && roles.every((r) => r === UserRole.PARENT || r === UserRole.STUDENT)
    ? 'family'
    : 'staff';
}
