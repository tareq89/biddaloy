import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { TemplateDetail } from './-template-detail';

/** [35.5.2] The preset warning banner on the template detail. */
describe('TemplateDetail preset banner', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mount(role: string, state: 'APPLIED' | 'AVAILABLE') {
    server.use(
      http.get('/api/v1/exam-templates/:id', () =>
        HttpResponse.json({ id: 't1', name: 'Annual', kind: 'TERM', rows: [] }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }),
      ),
      http.get('/api/v1/presets/status', () => HttpResponse.json({ state })),
    );
    renderWithProviders(<TemplateDetail templateId="t1" />, {
      locale: 'en',
      role,
      tenantId: 'tenant-1',
    });
  }

  it('shows with APPLIED for a viewer holding CURRICULUM_PRESET_APPLY', async () => {
    mount('ADMIN', 'APPLIED');
    expect(await screen.findByText(/This comes from your curriculum preset/)).toBeTruthy();
  });

  it('is absent with AVAILABLE', async () => {
    mount('ADMIN', 'AVAILABLE');
    await screen.findByText('Annual');
    expect(screen.queryByText(/This comes from your curriculum preset/)).toBeNull();
  });

  it('is not mounted without the permission', async () => {
    mount('TEACHER', 'APPLIED');
    await screen.findByText('Annual');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/This comes from your curriculum preset/)).toBeNull();
  });
});
