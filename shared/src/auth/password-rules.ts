import { UserRole } from '../enums/index';

export type PasswordAudience = 'staff' | 'family';
export type PasswordRuleId = 'minLength' | 'upper' | 'lower' | 'digit' | 'special';

const STAFF_RULES: PasswordRuleId[] = ['minLength', 'upper', 'lower', 'digit', 'special'];
const FAMILY_RULES: PasswordRuleId[] = ['minLength', 'digit'];

const TESTS: Record<PasswordRuleId, (p: string) => boolean> = {
  minLength: (p) => p.length >= 8,
  upper: (p) => /[A-Z]/.test(p),
  lower: (p) => /[a-z]/.test(p),
  digit: (p) => /[0-9০-৯]/.test(p),
  special: (p) => /[^A-Za-z0-9০-৯\s]/.test(p),
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
