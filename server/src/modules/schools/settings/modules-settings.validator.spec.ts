import { describe, it, expect } from 'vitest';
import {
  findLabelsReason,
  findModulesReason,
  LABELS_INVALID,
  MODULES_INVALID,
} from './modules-settings.validator';

describe('findModulesReason', () => {
  it('accepts a valid block, including null to remove a key', () => {
    expect(
      findModulesReason({ fees: { on: false }, exams: { offForRoles: ['TEACHER'] }, fines: null }),
    ).toBeNull();
    expect(findModulesReason({})).toBeNull();
  });
  it('rejects an unknown key with the fixed sentence', () => {
    expect(findModulesReason({ nope: { on: false } })).toBe(MODULES_INVALID.key);
  });
  it('rejects a core area key', () => {
    expect(findModulesReason({ students: { on: false } })).toBe(MODULES_INVALID.key);
  });
  it('rejects ADMIN and SUPER_ADMIN in offForRoles', () => {
    expect(findModulesReason({ fees: { offForRoles: ['ADMIN'] } })).toBe(MODULES_INVALID.roles);
    expect(findModulesReason({ fees: { offForRoles: ['SUPER_ADMIN'] } })).toBe(
      MODULES_INVALID.roles,
    );
    expect(findModulesReason({ fees: { offForRoles: ['WIZARD'] } })).toBe(MODULES_INVALID.roles);
  });
  it('rejects a repeated role in offForRoles', () => {
    expect(findModulesReason({ fees: { offForRoles: ['TEACHER', 'TEACHER'] } })).toBe(
      MODULES_INVALID.roles,
    );
  });
  it('rejects lock (platform-owned)', () => {
    expect(findModulesReason({ fees: { lock: 'on' } })).toBe(MODULES_INVALID.fields);
  });
  it('rejects a non-boolean on and a non-object block', () => {
    expect(findModulesReason({ fees: { on: 'yes' } })).toBe(MODULES_INVALID.on);
    expect(findModulesReason([])).toBe(MODULES_INVALID.shape);
  });
  it('never echoes the submitted value in its message', () => {
    expect(findModulesReason({ 'evil<script>': {} })).not.toContain('evil');
  });
});

describe('findLabelsReason', () => {
  const ok = { en: { one: 'Course', other: 'Courses' }, bn: 'কোর্স' };
  it('accepts a valid block, including null', () => {
    expect(findLabelsReason({ class: ok, student: null })).toBeNull();
  });
  it('rejects an unknown key and organisation-owned keys', () => {
    expect(findLabelsReason({ nope: ok })).toBe(LABELS_INVALID.key);
    expect(findLabelsReason({ shift: ok })).toBe(LABELS_INVALID.key);
  });
  it('rejects a 41-character word and accepts 40', () => {
    expect(findLabelsReason({ class: { bn: 'a'.repeat(41) } })).toBe(LABELS_INVALID.text);
    expect(findLabelsReason({ class: { bn: 'a'.repeat(40) } })).toBeNull();
  });
  it('rejects HTML, untrimmed and empty words', () => {
    expect(findLabelsReason({ class: { en: { one: '<b>x</b>' } } })).toBe(LABELS_INVALID.text);
    expect(findLabelsReason({ class: { bn: ' x' } })).toBe(LABELS_INVALID.text);
    expect(findLabelsReason({ class: { bn: '' } })).toBe(LABELS_INVALID.text);
  });
  it('rejects extra fields', () => {
    expect(findLabelsReason({ class: { fr: 'x' } })).toBe(LABELS_INVALID.fields);
  });
});
