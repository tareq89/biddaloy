import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { LatestResultCard } from './-latest-result-card';

function row(examName: string, gpa: number, isFail = false) {
  return {
    exam_id: `exam-${examName}`,
    exam_name: examName,
    exam_kind: 'TERM',
    published: true,
    total_marks: 480,
    gpa,
    grade: 'A',
    position: 3,
    is_fail: isFail,
  };
}

/** The server returns newest first. */
function mock(rows: unknown[]) {
  server.use(http.get('/api/v1/students/:id/results', () => HttpResponse.json(rows)));
}

function renderCard() {
  return renderPortalCard(<LatestResultCard childId="kid-a" childName="Fatima" />);
}

describe('LatestResultCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the newest published row with its GPA and a meter out of 5', async () => {
    mock([row('Half-yearly', 4.67), row('First term', 4.5)]);
    renderCard();

    expect((await screen.findAllByText('Fatima · Half-yearly')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('GPA 4.67').length).toBeGreaterThan(0);
    const meter = screen.getByRole('meter', { name: 'GPA out of 5' });
    expect(meter.getAttribute('aria-valuenow')).toBe('4.67');
    expect(meter.getAttribute('aria-valuemax')).toBe('5');
  });

  it('better than the previous exam', async () => {
    mock([row('Half-yearly', 4.67), row('First term', 4.5)]);
    renderCard();
    expect(
      (await screen.findAllByText('Better than the last exam (was 4.5)')).length,
    ).toBeGreaterThan(0);
  });

  it('lower than the previous exam', async () => {
    mock([row('Half-yearly', 4.2), row('First term', 4.5)]);
    renderCard();
    expect(
      (await screen.findAllByText('Lower than the last exam (was 4.5)')).length,
    ).toBeGreaterThan(0);
  });

  it('same as the previous exam', async () => {
    mock([row('Half-yearly', 4.5), row('First term', 4.5)]);
    renderCard();
    expect((await screen.findAllByText('Same as the last exam')).length).toBeGreaterThan(0);
  });

  it('a failed exam says so instead of a trend', async () => {
    mock([row('Half-yearly', 2.1, true), row('First term', 4.5)]);
    renderCard();
    expect(
      (await screen.findAllByText('Needs to improve: failed at least one subject')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Better than|Lower than/)).toBeNull();
  });

  it('one result only has no trend line', async () => {
    mock([row('Half-yearly', 4.67)]);
    renderCard();
    await screen.findAllByText('Fatima · Half-yearly');
    expect(screen.queryByText(/last exam/)).toBeNull();
  });

  it('no rows is empty, without an action', async () => {
    mock([]);
    renderCard();
    expect(await screen.findByText('No published result yet.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links to the full result for that child', async () => {
    mock([row('Half-yearly', 4.67)]);
    renderCard();
    const link = await screen.findByRole('link', { name: 'Full result' });
    expect(link.getAttribute('href')).toBe('/portal/results?student=kid-a');
  });

  it('renders no h1 and is axe clean', async () => {
    mock([row('Half-yearly', 4.67), row('First term', 4.5)]);
    const { container } = renderCard();
    await screen.findAllByText('Fatima · Half-yearly');
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    await expect(container).toHaveNoViolations();
  });
});
