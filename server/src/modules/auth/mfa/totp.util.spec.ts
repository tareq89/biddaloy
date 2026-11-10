import { describe, it, expect } from 'vitest';
import { generateSecret, issuerName, matchStep, otpauthUri } from './totp.util';

// RFC 6238 appendix B, SHA-1: ASCII secret "12345678901234567890", T=59s gives 94287082 (8 digits), so 287082 at 6.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp.util', () => {
  it('matches the RFC 6238 SHA-1 vector at 59 s (step 1)', () => {
    expect(matchStep(RFC_SECRET, '287082', 59_000)).toBe(1);
  });

  it('accepts a code one step away (window 1) and rejects two steps away', () => {
    // 287082 is the step-1 code; at t=89s the current step is 2, so it is delta -1.
    expect(matchStep(RFC_SECRET, '287082', 89_000)).toBe(1);
    // At t=119s the current step is 3: delta -2, outside the window.
    expect(matchStep(RFC_SECRET, '287082', 119_000)).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(matchStep(RFC_SECRET, '28708', 59_000)).toBeNull();
    expect(matchStep(RFC_SECRET, 'abcdef', 59_000)).toBeNull();
  });

  it('generates distinct base32 secrets and a labelled otpauth URI', () => {
    const a = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/);
    expect(a).not.toBe(generateSecret());
    const uri = otpauthUri(a, 'ops@example.test', 'Biddaloy Cockpit');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('adds the env name to the issuer outside production', () => {
    expect(issuerName('production', 'production')).toBe('Biddaloy Cockpit');
    expect(issuerName('staging', 'production')).toBe('Biddaloy Cockpit (staging)');
    expect(issuerName('local', 'development')).toBe('Biddaloy Cockpit (local)');
  });
});
