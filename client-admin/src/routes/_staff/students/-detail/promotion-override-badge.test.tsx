import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PromotionOverrideBadge } from './promotion-override-badge';

const STUDENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

afterEach(async () => {
  await cleanupTestState();
});

function renderBadge() {
  return renderWithProviders(<PromotionOverrideBadge studentId={STUDENT_ID} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}

describe('PromotionOverrideBadge', () => {
  it('renders nothing when the student has no overrides', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
    );

    const { container } = renderBadge();

    await waitFor(() => expect(container.querySelector('span')).toBeNull());
  });

  it('shows the latest override note, year and who did it, reachable by screen reader', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/promotion-overrides', () =>
        HttpResponse.json([
          {
            run_id: 'run-1',
            target_academic_year_name: '2025-2026',
            final_outcome: 'RETAIN',
            override_note: 'Repeated failure in Math',
            overridden_by_name: 'Jane Admin',
            committed_at: '2026-06-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderBadge();

    const badge = await screen.findByText(/2025-2026.*Repeated failure in Math.*Jane Admin/);
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/^Retained by override/);
  });

  it('uses outcome-specific text for GRADUATE, not always "Promoted"', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/promotion-overrides', () =>
        HttpResponse.json([
          {
            run_id: 'run-1',
            target_academic_year_name: '2026-2027',
            final_outcome: 'GRADUATE',
            override_note: 'Graduated early',
            overridden_by_name: 'Jane Admin',
            committed_at: '2026-06-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderBadge();

    const badge = await screen.findByText(/Graduated early/);
    expect(badge.textContent).toMatch(/^Graduated by override/);
  });

  it('uses outcome-specific text for PROMOTE', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/promotion-overrides', () =>
        HttpResponse.json([
          {
            run_id: 'run-1',
            target_academic_year_name: '2026-2027',
            final_outcome: 'PROMOTE',
            override_note: 'Manual review, promoted',
            overridden_by_name: 'Jane Admin',
            committed_at: '2026-06-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderBadge();

    const badge = await screen.findByText(/Manual review, promoted/);
    expect(badge.textContent).toMatch(/^Promoted by override/);
  });

  it('shows the most recently committed override when there are several', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/promotion-overrides', () =>
        HttpResponse.json([
          {
            run_id: 'run-1',
            target_academic_year_name: '2024-2025',
            final_outcome: 'RETAIN',
            override_note: 'Older note',
            overridden_by_name: 'Old Admin',
            committed_at: '2025-06-01T00:00:00.000Z',
          },
          {
            run_id: 'run-2',
            target_academic_year_name: '2025-2026',
            final_outcome: 'PROMOTE',
            override_note: 'Newer note',
            overridden_by_name: 'New Admin',
            committed_at: '2026-06-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderBadge();

    await waitFor(() => expect(screen.getByText(/Newer note/)).not.toBeNull());
    expect(screen.queryByText(/Older note/)).toBeNull();
  });
});
