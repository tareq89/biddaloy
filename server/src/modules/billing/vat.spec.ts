import { describe, it, expect } from 'vitest';
import { vatIncluded } from './vat';

describe('vatIncluded', () => {
  it('gross 11_500 at 1500 bp -> 1500', () => {
    expect(vatIncluded(11_500, 1500)).toBe(1500);
  });

  it('gross 10_000 at 1500 bp -> 1305', () => {
    // net floor(8695.65)=8695
    expect(vatIncluded(10_000, 1500)).toBe(1305);
  });

  it('gross 1 at 1500 bp -> 1', () => {
    // net floor(0.87)=0
    expect(vatIncluded(1, 1500)).toBe(1);
  });

  it('gross 100 at 1 bp -> 1', () => {
    // net floor(99.99)=99: the floor formula puts the odd paisa on VAT
    expect(vatIncluded(100, 1)).toBe(1);
  });

  it('gross 0 at 1500 bp -> 0', () => {
    expect(vatIncluded(0, 1500)).toBe(0);
  });

  it('gross 10_000 at 0 bp -> 0', () => {
    expect(vatIncluded(10_000, 0)).toBe(0);
  });

  it('gross 9_999_999_999 at 5000 bp -> 3_333_333_333', () => {
    // net floor(6666666666.0)
    expect(vatIncluded(9_999_999_999, 5000)).toBe(3_333_333_333);
  });

  it('net + vat always equals gross, whole paisa', () => {
    for (let g = 0; g < 3000; g += 7) {
      for (const bp of [1, 250, 1500, 5000]) {
        const v = vatIncluded(g, bp);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(g);
      }
    }
  });
});
