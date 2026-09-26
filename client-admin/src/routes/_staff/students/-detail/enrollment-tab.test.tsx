import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { EnrollmentTab } from './enrollment-tab';

const STUDENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

afterEach(async () => {
  await cleanupTestState();
});

function enrollment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'enrollment-1',
    student_id: STUDENT_ID,
    class: { id: 'class-1', name: 'Class 6' },
    class_id: 'class-1',
    section: { id: 'section-1', section_name: 'A' },
    section_id: 'section-1',
    academic_year: { id: 'year-1', name: '2025-2026' },
    academic_year_id: 'year-1',
    enrollment_status: 'ACTIVE',
    enrolled_at: '2025-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab() {
  return renderWithProviders(
    <EnrollmentTab studentId={STUDENT_ID} studentName="Test Student" />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

describe('EnrollmentTab', () => {
  it('renders an override line under the enrollment matching its target year', async () => {
    server.use(
      http.get('/api/v1/enrollments/student/:studentId', () =>
        HttpResponse.json([
          enrollment({ id: 'enrollment-1', academic_year: { id: 'year-1', name: '2025-2026' } }),
          enrollment({
            id: 'enrollment-2',
            academic_year: { id: 'year-0', name: '2024-2025' },
            enrolled_at: '2024-06-01T00:00:00.000Z',
          }),
        ]),
      ),
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

    renderTab();

    const line = await screen.findByText(/Repeated failure in Math/);
    expect(line.textContent).toContain('2025-2026');
    expect(line.textContent).toContain('Jane Admin');
    // Exactly one line — the 2024-2025 enrollment has no matching override.
    expect(screen.getAllByText(/Repeated failure in Math/)).toHaveLength(1);
  });

  it('renders no override line when there are no overrides', async () => {
    server.use(
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([enrollment()])),
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
    );

    renderTab();

    await waitFor(() => expect(screen.getByText('Class 6')).not.toBeNull());
    expect(screen.queryByText(/by override/)).toBeNull();
  });
});
