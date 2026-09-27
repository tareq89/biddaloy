import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordTab } from './hr-record-tab';

afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordTab', () => {
  it('renders the job and promotion sections, expanded by default', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () =>
        HttpResponse.json([
          {
            id: 'hr-1',
            user_id: 'user-1',
            index_no: 'IDX-1',
            salary_code: null,
            mpo_date: null,
            salary_scale: null,
            department: 'Science',
            blood_group: null,
            religion: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json([
          {
            id: 'hist-1',
            user_id: 'user-1',
            designation_id: 'designation-1',
            effective_date: '2026-01-01',
            end_date: null,
            status: 'REGULAR',
            notes: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
      http.get('/api/v1/designations', () =>
        HttpResponse.json([
          { id: 'designation-1', title_en: 'Assistant Teacher', title_bn: null, is_teaching: true },
        ]),
      ),
    );

    renderWithProviders(<HrRecordTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('Science')).toBeTruthy();
    expect(await screen.findByText('Assistant Teacher')).toBeTruthy();
    expect(await screen.findByText('Current')).toBeTruthy();

    // Every other section is stubbed with the same placeholder — 8 of them
    // (family, address, experience, education, training, achievement,
    // language, documents).
    expect((await screen.findAllByText('Coming soon')).length).toBe(8);
  });

  it('shows the job section empty state when the user has no HR record yet', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])),
      http.get('/api/v1/staff-hr-records/user-2/designation-history', () => HttpResponse.json([])),
      http.get('/api/v1/designations', () => HttpResponse.json([])),
    );

    renderWithProviders(<HrRecordTab userId="user-2" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('No HR record yet')).toBeTruthy();
    expect(await screen.findByText('No promotions recorded yet')).toBeTruthy();
  });
});
