import { describe, expect, it } from 'vitest';

import { CODED_REPORTS, visibleCodedReports } from './-coded-reports';

const anyone = () => true;

describe('visibleCodedReports modules (D16)', () => {
  it('hides the link of an off module, keeps the rest', () => {
    const shown = visibleCodedReports(anyone, (m) => m !== 'fees').map((r) => r.id);
    expect(shown).not.toContain('collections');
    expect(shown).toContain('attendance-reports');
  });

  it('shows every permitted report when all modules are on', () => {
    expect(visibleCodedReports(anyone)).toHaveLength(CODED_REPORTS.length);
  });

  it('never hides a core report', () => {
    const shown = visibleCodedReports(anyone, (m) => m === 'core').map((r) => r.id);
    expect(shown).toEqual(CODED_REPORTS.filter((r) => r.module === 'core').map((r) => r.id));
  });
});
