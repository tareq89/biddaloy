import { describe, it, expect } from 'vitest';
import { buildBackupLink, failureReason, formatSizeMb, formatTimestamp } from './backup-email';
import {
  render,
  TemplateKind,
  TemplateMedium,
  TemplateLocale,
} from '../../account-access/account-access-templates';

describe('buildBackupLink', () => {
  it('composes the settings deep link and url-encodes the job id', () => {
    expect(buildBackupLink('https://app.biddaloy.com', 'job/1 2')).toBe(
      'https://app.biddaloy.com/settings?backup=job%2F1%202',
    );
  });
});

describe('formatSizeMb', () => {
  it('converts bytes to one-decimal MB', () => {
    expect(formatSizeMb('1048576')).toBe('1.0');
  });

  it('handles zero', () => {
    expect(formatSizeMb('0')).toBe('0.0');
  });

  it('handles null', () => {
    expect(formatSizeMb(null)).toBe('0.0');
  });

  it('never returns NaN for garbage input', () => {
    expect(formatSizeMb('not-a-number')).toBe('0.0');
  });
});

describe('formatTimestamp', () => {
  const fixed = new Date('2026-01-15T10:30:00.000Z');

  it('renders differently for bn vs en', () => {
    const en = formatTimestamp(fixed, 'en', 'UTC');
    const bn = formatTimestamp(fixed, 'bn', 'UTC');
    expect(en).not.toBe('');
    expect(bn).not.toBe('');
    expect(en).not.toBe(bn);
  });

  it('returns empty string for null', () => {
    expect(formatTimestamp(null, 'en', 'UTC')).toBe('');
  });

  it('falls back to UTC instead of throwing on an invalid timezone', () => {
    expect(() => formatTimestamp(fixed, 'en', 'Not/A_Timezone')).not.toThrow();
    const fallback = formatTimestamp(fixed, 'en', 'Not/A_Timezone');
    const utc = formatTimestamp(fixed, 'en', 'UTC');
    expect(fallback).toBe(utc);
  });
});

describe('failureReason', () => {
  it('keeps only the first line of multi-line input', () => {
    expect(failureReason('first line\nsecond line\nthird line')).toBe('first line');
  });

  it('truncates over-long input to 200 chars', () => {
    const long = 'x'.repeat(500);
    const result = failureReason(long);
    expect(result.length).toBe(200);
  });

  it('returns the generic sentence for null', () => {
    expect(failureReason(null)).toBe('The export could not be completed.');
  });

  it('returns the generic sentence for empty string', () => {
    expect(failureReason('')).toBe('The export could not be completed.');
  });

  it('returns the generic sentence for whitespace-only input', () => {
    expect(failureReason('   \n  ')).toBe('The export could not be completed.');
  });
});

describe('new template kinds render without missing interpolation', () => {
  const kinds: TemplateKind[] = ['BACKUP_READY', 'BACKUP_FAILED', 'RESTORE_DONE', 'RESTORE_FAILED'];
  const mediums: TemplateMedium[] = ['SMS', 'EMAIL'];
  const locales: TemplateLocale[] = ['bn', 'en'];

  const fullVars = {
    school: 'Test School',
    name: 'Test User',
    link: 'https://app.biddaloy.com/settings?backup=job-1',
    size_mb: '12.3',
    finished_at: '15 Jan 2026, 10:30',
    expires_at: '22 Jan 2026, 10:30',
    reason: 'Storage quota exceeded',
  };

  for (const kind of kinds) {
    for (const medium of mediums) {
      for (const locale of locales) {
        it(`${kind}/${medium}/${locale} renders with no unfilled placeholders (vars populated)`, () => {
          const result = render(kind, medium, locale, fullVars);
          expect(result.body).not.toContain('{{');
          if (result.subject) expect(result.subject).not.toContain('{{');
        });

        it(`${kind}/${medium}/${locale} renders with no unfilled placeholders or literal undefined (vars omitted)`, () => {
          const result = render(kind, medium, locale, { school: 'Test School', name: 'Test User' });
          expect(result.body).not.toContain('{{');
          expect(result.body).not.toContain('undefined');
          if (result.subject) {
            expect(result.subject).not.toContain('{{');
            expect(result.subject).not.toContain('undefined');
          }
        });
      }
    }
  }
});
