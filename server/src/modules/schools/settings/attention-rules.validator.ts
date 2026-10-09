import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { alertRuleMeta, isAlertRuleKey } from '@biddaloy/shared';

/** Returns why `value` is invalid, or `null`. Single source for validate() + defaultMessage(). */
function findInvalidReason(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'must be an object';
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isAlertRuleKey(key)) return `unknown rule ${key}`;
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 1 ||
      typeof (entry as { enabled?: unknown }).enabled !== 'boolean'
    ) {
      return `rule ${key} must be exactly { enabled: boolean }`;
    }
    if ((entry as { enabled: boolean }).enabled === false && !alertRuleMeta(key).canDisable) {
      return `rule ${key} cannot be switched off`;
    }
  }
  return null;
}

/** [67.1.06] `attention.rules` — known keys, `{ enabled }` only, CRITICAL rules stay on (D34). Stateless. */
@ValidatorConstraint({ name: 'attentionRules', async: false })
export class AttentionRulesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return findInvalidReason(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return `"${args.property}": ${findInvalidReason(args.value)}`;
  }
}
