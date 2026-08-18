// Fixture-directory coverage for the real check, not just its pure
// helpers — `flattenKeys` alone can't prove the locale-parity/call-site
// logic in `runCheck` actually wires together correctly, and a false
// negative here is a check that silently stops catching what it exists
// to catch.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { flattenKeys, runCheck } from './check-i18n-keys.mjs';

const tempDirs = [];

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'check-i18n-'));
  tempDirs.push(root);
  const localesDir = join(root, 'locales');
  const sourceDir = join(root, 'src');
  mkdirSync(localesDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  return { root, localesDir, sourceDir };
}

function writeLocale(localesDir, locale, namespace, content) {
  const dir = join(localesDir, locale);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${namespace}.json`), JSON.stringify(content), 'utf8');
}

function writeSource(sourceDir, name, content) {
  writeFileSync(join(sourceDir, name), content, 'utf8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('flattenKeys', () => {
  it('flattens nested objects into dot paths', () => {
    expect(
      flattenKeys({ actions: { save: 'Save', cancel: 'Cancel' }, title: 'Hi' }).sort(),
    ).toEqual(['actions.cancel', 'actions.save', 'title'].sort());
  });

  it('returns an empty array for an empty object', () => {
    expect(flattenKeys({})).toEqual([]);
  });
});

describe('runCheck — locale parity', () => {
  it('passes when both locales define the same keys', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { actions: { save: 'সংরক্ষণ' } });
    writeLocale(localesDir, 'en', 'common', { actions: { save: 'Save' } });

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });

  it('fails when a key exists in one locale but not the other', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { actions: { save: 'সংরক্ষণ', cancel: 'বাতিল' } });
    writeLocale(localesDir, 'en', 'common', { actions: { save: 'Save' } });

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toContain('[common] "actions.cancel" exists in bn but is missing from en.');
  });
});

describe('runCheck — t() call sites', () => {
  it('passes when every t() call resolves to a real key', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { actions: { save: 'সংরক্ষণ' } });
    writeLocale(localesDir, 'en', 'common', { actions: { save: 'Save' } });
    writeSource(sourceDir, 'button.tsx', "const { t } = useTranslation();\nt('actions.save');\n");

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });

  it('fails on a t() call with no matching key in any locale', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { actions: { save: 'সংরক্ষণ' } });
    writeLocale(localesDir, 'en', 'common', { actions: { save: 'Save' } });
    writeSource(sourceDir, 'button.tsx', "const { t } = useTranslation();\nt('actions.delete');\n");

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors.some((e) => e.includes('t("actions.delete")'))).toBe(true);
  });

  it('fails when a call site names a namespace with no locale files at all', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { title: 'শিরোনাম' });
    writeLocale(localesDir, 'en', 'common', { title: 'Title' });
    writeSource(
      sourceDir,
      'page.tsx',
      "const { t } = useTranslation('nonexistent');\nt('title');\n",
    );

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors.some((e) => e.includes('has no locale files'))).toBe(true);
  });

  it('resolves the namespace from an explicit { ns } option over the file-level useTranslation()', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { save: 'সংরক্ষণ' });
    writeLocale(localesDir, 'en', 'common', { save: 'Save' });
    writeLocale(localesDir, 'bn', 'students', { title: 'শিক্ষার্থী' });
    writeLocale(localesDir, 'en', 'students', { title: 'Students' });
    // File-level namespace is "students" (first useTranslation call), but
    // this specific t() call explicitly overrides to "common" — this is
    // exactly the ambiguity documented in check-i18n-keys.mjs's header,
    // and the escape hatch it recommends.
    writeSource(
      sourceDir,
      'mixed.tsx',
      "useTranslation('students');\nt('save', { ns: 'common' });\n",
    );

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });

  it('falls back to the common namespace when no useTranslation(ns) is in scope', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { save: 'সংরক্ষণ' });
    writeLocale(localesDir, 'en', 'common', { save: 'Save' });
    writeSource(sourceDir, 'button.tsx', "const { t } = useTranslation();\nt('save');\n");

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });

  it('resolves a t() call against i18next plural-suffixed keys (someKey_one/_other), not a bare key', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', {
      attempts_one: 'একবার',
      attempts_other: '{{count}} বার',
    });
    writeLocale(localesDir, 'en', 'common', {
      attempts_one: 'once',
      attempts_other: '{{count}} times',
    });
    writeSource(
      sourceDir,
      'banner.tsx',
      "const { t } = useTranslation();\nt('attempts', { count: n });\n",
    );

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });

  it('does not resolve a plural-only key against a call with no count — i18next itself would not either', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', {
      attempts_one: 'একবার',
      attempts_other: '{{count}} বার',
    });
    writeLocale(localesDir, 'en', 'common', {
      attempts_one: 'once',
      attempts_other: '{{count}} times',
    });
    // No `count` in the options — this call would render the raw key at
    // runtime, not fall back to a plural form, so it must still fail here.
    writeSource(sourceDir, 'banner.tsx', "const { t } = useTranslation();\nt('attempts');\n");

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors.some((e) => e.includes('t("attempts")'))).toBe(true);
  });

  it('does not attempt to check a computed key — known, accepted blind spot', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', {});
    writeLocale(localesDir, 'en', 'common', {});
    writeSource(sourceDir, 'dynamic.tsx', "const key = 'whatever';\nt(key);\n");

    const { errors } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
  });
});

describe('runCheck — unused keys', () => {
  it('reports a key nothing references, without adding it to errors', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { save: 'সংরক্ষণ', cancel: 'বাতিল' });
    writeLocale(localesDir, 'en', 'common', { save: 'Save', cancel: 'Cancel' });
    writeSource(sourceDir, 'button.tsx', "const { t } = useTranslation();\nt('save');\n");

    const { errors, unused } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(errors).toEqual([]);
    expect(unused).toEqual(['[common] cancel']);
  });

  it('does not report a plural-suffixed key as unused once its base is referenced', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', {
      attempts_one: 'একবার',
      attempts_other: '{{count}} বার',
    });
    writeLocale(localesDir, 'en', 'common', {
      attempts_one: 'once',
      attempts_other: '{{count}} times',
    });
    writeSource(
      sourceDir,
      'banner.tsx',
      "const { t } = useTranslation();\nt('attempts', { count: n });\n",
    );

    const { unused } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(unused).toEqual([]);
  });

  it('still reports plural-suffixed keys as unused when the only call site has no count', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', {
      attempts_one: 'একবার',
      attempts_other: '{{count}} বার',
    });
    writeLocale(localesDir, 'en', 'common', {
      attempts_one: 'once',
      attempts_other: '{{count}} times',
    });
    writeSource(sourceDir, 'banner.tsx', "const { t } = useTranslation();\nt('attempts');\n");

    const { unused } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(unused.sort()).toEqual(['[common] attempts_one', '[common] attempts_other'].sort());
  });

  it('reports nothing unused when every key is referenced', () => {
    const { localesDir, sourceDir } = makeFixture();
    writeLocale(localesDir, 'bn', 'common', { save: 'সংরক্ষণ' });
    writeLocale(localesDir, 'en', 'common', { save: 'Save' });
    writeSource(sourceDir, 'button.tsx', "const { t } = useTranslation();\nt('save');\n");

    const { unused } = runCheck({ localesDir, sourceDirs: [sourceDir] });

    expect(unused).toEqual([]);
  });
});
