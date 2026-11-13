import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CORE_AREAS, EntityLabel, ModuleKey, UserRole } from '@biddaloy/shared';

/** Fixed sentences (Rule 23): never echo the submitted key or value. */
export const MODULES_INVALID = {
  shape: 'modules must be an object of module settings',
  key: 'modules contains an unknown or core module',
  entry: 'each module setting must be an object, or null to remove it',
  fields: 'a module setting may only carry on and offForRoles',
  on: 'a module setting "on" must be true or false',
  roles: 'offForRoles must list roles other than ADMIN and SUPER_ADMIN',
} as const;

export const LABELS_INVALID = {
  shape: 'labels must be an object of words',
  key: 'labels contains an unknown word key',
  entry: 'each word must be an object, or null to remove it',
  fields: 'a word may only carry en (one, other) and bn',
  text: 'each word must be 1 to 40 characters, trimmed, with no HTML',
} as const;

const MODULE_KEYS = new Set<string>(Object.values(ModuleKey));
const CORE = new Set<string>(CORE_AREAS);
// shift/version/group live on `organisation` (D17), so they are not label keys here.
const LABEL_KEYS = new Set<string>(
  Object.values(EntityLabel).filter((k) => !['shift', 'version', 'group'].includes(k)),
);
const ROLE_OK = new Set<string>(
  Object.values(UserRole).filter((r) => r !== UserRole.ADMIN && r !== UserRole.SUPER_ADMIN),
);

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const onlyKeys = (o: Record<string, unknown>, allowed: string[]) =>
  Object.keys(o).every((k) => allowed.includes(k));

/** Returns the fixed reason a `modules` block is invalid, or `null` when valid. */
export function findModulesReason(value: unknown): string | null {
  if (!isObj(value)) return MODULES_INVALID.shape;
  for (const [key, entry] of Object.entries(value)) {
    if (!MODULE_KEYS.has(key) || CORE.has(key)) return MODULES_INVALID.key;
    if (entry === null) continue;
    if (!isObj(entry)) return MODULES_INVALID.entry;
    // `lock` is platform-owned (D50): rejected here along with anything else unknown.
    if (!onlyKeys(entry, ['on', 'offForRoles'])) return MODULES_INVALID.fields;
    if (entry.on !== undefined && typeof entry.on !== 'boolean') return MODULES_INVALID.on;
    if (entry.offForRoles !== undefined) {
      const roles = entry.offForRoles;
      if (
        !Array.isArray(roles) ||
        roles.length > 20 ||
        !roles.every((r) => typeof r === 'string' && ROLE_OK.has(r))
      ) {
        return MODULES_INVALID.roles;
      }
    }
  }
  return null;
}

const validText = (v: unknown): boolean =>
  typeof v === 'string' && v.length >= 1 && v.length <= 40 && v.trim() === v && !/[<>]/.test(v);

/** Returns the fixed reason a `labels` block is invalid, or `null` when valid. */
export function findLabelsReason(value: unknown): string | null {
  if (!isObj(value)) return LABELS_INVALID.shape;
  for (const [key, entry] of Object.entries(value)) {
    if (!LABEL_KEYS.has(key)) return LABELS_INVALID.key;
    if (entry === null) continue;
    if (!isObj(entry)) return LABELS_INVALID.entry;
    if (!onlyKeys(entry, ['en', 'bn'])) return LABELS_INVALID.fields;
    if (entry.bn !== undefined && !validText(entry.bn)) return LABELS_INVALID.text;
    if (entry.en !== undefined) {
      if (!isObj(entry.en) || !onlyKeys(entry.en, ['one', 'other'])) return LABELS_INVALID.fields;
      for (const w of Object.values(entry.en)) if (!validText(w)) return LABELS_INVALID.text;
    }
  }
  return null;
}

/** Stateless (see UniqueLabelListConstraint): the message is derived from the arguments. */
@ValidatorConstraint({ name: 'isModulesBlock', async: false })
export class ModulesBlockConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return findModulesReason(value) === null;
  }
  defaultMessage(args: ValidationArguments): string {
    return findModulesReason(args.value) ?? MODULES_INVALID.shape;
  }
}

@ValidatorConstraint({ name: 'isLabelsBlock', async: false })
export class LabelsBlockConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return findLabelsReason(value) === null;
  }
  defaultMessage(args: ValidationArguments): string {
    return findLabelsReason(args.value) ?? LABELS_INVALID.shape;
  }
}
