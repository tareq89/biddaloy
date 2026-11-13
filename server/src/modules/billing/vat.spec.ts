import { describe, it, expect } from 'vitest';
import { vatIncluded } from './vat';

describe('vatIncluded', () => {
  it.each([
    [11_500, 1500, 1500],
    [10_000, 1500, 1305], // net floor(8695.65)=8695
    [1, 1500, 1], // net floor(0.87)=0
    [100, 1, 1], // net floor(99.99)=99: the floor formula puts the odd paisa on VAT
    [0, 1500, 0],
    [10_000, 0, 0],
    [9_999_999_999, 5000, 3_333_333_333], // net floor(6666666666.0),
  ])('gross %i at %i bp -> %i', (gross, bp, want) => {
    expect(vatIncluded(gross, bp)).toBe(want);
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
