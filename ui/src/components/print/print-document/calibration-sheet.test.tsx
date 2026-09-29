import { PrinterType } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { buildCalibrationDocument } from './calibration-sheet';

const printer = { type: PrinterType.OFFICE, offsetXMm: 0.5, offsetYMm: 1, scale: 0.99 };
const html = buildCalibrationDocument(printer, { widthMm: 85.6, heightMm: 54 });
const doc = new DOMParser().parseFromString(html, 'text/html');

describe('buildCalibrationDocument', () => {
  it('draws a 1 mm ruler with labels every 10 mm', () => {
    expect(doc.querySelectorAll('line[x1="37"][y1="0"]')).toHaveLength(1);
    expect(doc.querySelectorAll('line[x1="10"][y2="4"]')).toHaveLength(1);
    expect([...doc.querySelectorAll('text')].some((t) => t.textContent === '200')).toBe(true);
    expect(doc.querySelectorAll('line[x1="0"][y1="290"]')).toHaveLength(1);
  });

  it('puts crosshairs at (20,20) and (page-20,page-20) on A4', () => {
    expect(doc.querySelector('[data-crosshair="20,20"]')).not.toBeNull();
    expect(doc.querySelector('[data-crosshair="190,277"]')).not.toBeNull();
  });

  it('draws the dashed no-print band and the instruction', () => {
    expect(
      doc.querySelector('[data-testid="no-print-band"]')?.getAttribute('stroke-dasharray'),
    ).toBe('2 1');
    expect(html).toContain('Measure how far the crosshair moved');
  });

  it('uses the printer offset and scale', () => {
    expect(html).toContain('translate(0.5mm,1mm) scale(0.99)');
    expect(html).not.toMatch(/<script/i);
  });
});
