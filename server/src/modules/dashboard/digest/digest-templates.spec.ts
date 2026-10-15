import { describe, it, expect } from 'vitest';
import { renderDigest } from './digest-templates';

const top = (over: Record<string, unknown> = {}) =>
  ({ title: 'Attendance not taken', ...over }) as any;

describe('renderDigest', () => {
  it('returns null when there is nothing to say (count 0)', () => {
    expect(renderDigest({ critical: 0, warning: 0, reminder: 0, top: null }, 'en', 'S')).toBeNull();
  });

  it('en: count plus the top item title, school name as title', () => {
    const out = renderDigest({ critical: 1, warning: 1, reminder: 1, top: top() }, 'en', 'Sunrise');
    expect(out).toEqual({
      title: 'Sunrise',
      body: '3 things need you today. Most urgent: Attendance not taken',
    });
  });

  it('en: singular for one item', () => {
    const out = renderDigest({ critical: 0, warning: 0, reminder: 1, top: null }, 'en', 'S');
    expect(out!.body).toBe('1 thing needs you today.');
  });

  it('bn: Bangla digits', () => {
    const out = renderDigest({ critical: 3, warning: 0, reminder: 0, top: top() }, 'bn', 'S');
    expect(out!.body).toContain('আজ ৩টা বিষয় আপনার নজর চাইছে।');
    expect(out!.body).toContain('সবচেয়ে জরুরি: Attendance not taken');
  });

  it('leaves out a top title that names a student (no PII on a lock screen)', () => {
    const out = renderDigest(
      { critical: 1, warning: 0, reminder: 0, top: top({ studentName: 'Rahim' }) },
      'en',
      'S',
    );
    expect(out!.body).toBe('1 thing needs you today.');
  });
});
