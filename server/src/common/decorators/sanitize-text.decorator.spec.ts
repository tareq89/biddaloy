import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { SanitizeAllowlist, SanitizeText } from './sanitize-text.decorator';

// require(), not a static import — see sanitize-text.decorator.ts's comment on
// why a static `import { sanitizeStrict } from '@beton-boi/shared'` silently
// binds to undefined under this repo's vitest config.
const { sanitizeAllowlist, sanitizeStrict } = require('@beton-boi/shared') as typeof import('@beton-boi/shared');

class StrictDto {
  @SanitizeText()
  name!: string;
}

class AllowlistDto {
  @SanitizeAllowlist(['b'])
  bio!: string;
}

describe('sanitizeStrict', () => {
  it('neutralises a script payload', () => {
    expect(sanitizeStrict('<script>alert(1)</script>')).toBe('');
    expect(sanitizeStrict('<img src=x onerror=alert(1)>hello')).toBe('hello');
  });

  it('strips markup but keeps the text content', () => {
    expect(sanitizeStrict('<b>bold</b> text')).toBe('bold text');
  });

  it('leaves an apostrophe untouched', () => {
    expect(sanitizeStrict("O'Brien")).toBe("O'Brien");
  });

  it('leaves an ampersand untouched rather than HTML-entity-encoding it', () => {
    expect(sanitizeStrict('Tom & Jerry School')).toBe('Tom & Jerry School');
  });

  it('leaves Bengali/Unicode names untouched', () => {
    expect(sanitizeStrict('রহিম উদ্দিন')).toBe('রহিম উদ্দিন');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeStrict('  Rahim Uddin  ')).toBe('Rahim Uddin');
  });

  it('normalizes Unicode to NFKC', () => {
    // U+FF21 FULLWIDTH LATIN CAPITAL LETTER A -> normalizes to ASCII 'A'.
    expect(sanitizeStrict('ＡBC')).toBe('ABC');
  });

  it('reduces an all-markup value to an empty string', () => {
    expect(sanitizeStrict('<div><span></span></div>')).toBe('');
  });
});

describe('sanitizeAllowlist', () => {
  it('keeps an allowed tag but strips a disallowed one', () => {
    expect(sanitizeAllowlist('<b>bold</b><script>alert(1)</script>', ['b'])).toBe('<b>bold</b>');
  });

  it('strips everything when the allowlist is empty, same as strict', () => {
    expect(sanitizeAllowlist('<b>bold</b>', [])).toBe('bold');
  });

  it('keeps only allowlisted attributes on an allowed tag', () => {
    const result = sanitizeAllowlist('<a href="https://example.com" onclick="evil()">link</a>', ['a'], {
      a: ['href'],
    });
    expect(result).toBe('<a href="https://example.com">link</a>');
  });
});

describe('SanitizeText decorator', () => {
  it('sanitizes a string field via plainToInstance', () => {
    const dto = plainToInstance(StrictDto, { name: '<script>alert(1)</script>Rahim' });
    expect(dto.name).toBe('Rahim');
  });

  it('passes non-string values through untouched, leaving type validation to catch them', () => {
    const dto = plainToInstance(StrictDto, { name: 12345 });
    expect(dto.name).toBe(12345);
  });

  it('passes undefined through untouched for an absent optional field', () => {
    const dto = plainToInstance(StrictDto, {});
    expect(dto.name).toBeUndefined();
  });
});

describe('SanitizeAllowlist decorator', () => {
  it('applies the allowlist policy via plainToInstance', () => {
    const dto = plainToInstance(AllowlistDto, { bio: '<b>Teacher</b><script>alert(1)</script>' });
    expect(dto.bio).toBe('<b>Teacher</b>');
  });
});
