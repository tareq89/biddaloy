import type { BandInput } from '@biddaloy/ui/hooks';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import { computeSegments, CoverageBar } from './-coverage-bar';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

function band(percent_from: number, percent_to: number, sequence: number): BandInput {
  return {
    percent_from,
    percent_to,
    grade: 'X',
    gpa: null,
    is_fail: false,
    sequence,
    comment: null,
  };
}

function renderBar(bands: BandInput[]) {
  return render(
    <I18nProvider>
      <CoverageBar bands={bands} />
    </I18nProvider>,
  );
}

describe('computeSegments', () => {
  it('reports full coverage as a single covered segment', () => {
    const segments = computeSegments([band(0, 100, 1)]);
    expect(segments).toEqual([{ from: 0, to: 100, kind: 'covered' }]);
  });

  it('reports an uncovered range as a gap segment', () => {
    const segments = computeSegments([band(0, 49, 1), band(60, 100, 2)]);
    expect(segments.some((s) => s.kind === 'gap' && s.from === 50 && s.to === 59)).toBe(true);
  });

  it('reports a doubly-claimed range as an overlap segment', () => {
    const segments = computeSegments([band(0, 60, 1), band(50, 100, 2)]);
    expect(segments.some((s) => s.kind === 'overlap' && s.from === 50 && s.to === 60)).toBe(true);
  });
});

describe('CoverageBar', () => {
  it('renders only band segments for full coverage', async () => {
    renderBar([band(0, 100, 1)]);
    expect(await screen.findAllByTestId('coverage-band')).toHaveLength(1);
    expect(screen.queryByTestId('coverage-gap')).toBeNull();
    expect(screen.queryByTestId('coverage-overlap')).toBeNull();
  });

  it('renders a gap segment for an uncovered range', async () => {
    renderBar([band(0, 49, 1), band(60, 100, 2)]);
    expect(await screen.findAllByTestId('coverage-gap')).toHaveLength(1);
  });

  it('renders an overlap segment for a doubly-claimed range', async () => {
    renderBar([band(0, 60, 1), band(50, 100, 2)]);
    expect(await screen.findAllByTestId('coverage-overlap')).toHaveLength(1);
  });
});
