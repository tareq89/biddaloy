import { describe, it, expect } from 'vitest';

import { boundedNumericString } from './zod-helpers';

describe('boundedNumericString', () => {
  const schema = boundedNumericString(0, 4);

  it('accepts a value inside the range', () => {
    expect(schema.safeParse('2').success).toBe(true);
  });

  it('accepts a boundary value', () => {
    expect(schema.safeParse('0').success).toBe(true);
    expect(schema.safeParse('4').success).toBe(true);
  });

  it('rejects a value above the range', () => {
    expect(schema.safeParse('5').success).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    expect(schema.safeParse('abc').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(schema.safeParse('').success).toBe(false);
  });
});
