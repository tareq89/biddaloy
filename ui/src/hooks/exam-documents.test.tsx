import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  familyAdmitCardAssetBase,
  logDocumentPrint,
  printFamilyAdmitCard,
  useAdmitCardRoster,
  useMeritCandidates,
  useTabulation,
  useTranscript,
} from './exam-documents';

const opts = { tenantId: 'tenant-1' };

describe('exam document queries', () => {
  it('useAdmitCardRoster calls the roster path and is idle without an exam id', async () => {
    server.use(
      http.get('/api/v1/exams/e-1/documents/admit-cards', () =>
        HttpResponse.json({ withhold_for_dues: false, seat_plan_published: true, students: [] }),
      ),
    );
    const idle = renderHookWithProviders(() => useAdmitCardRoster(undefined), opts);
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => useAdmitCardRoster('e-1'), opts);
    await waitFor(() => expect(result.current.data?.seat_plan_published).toBe(true));
  });

  it('useMeritCandidates sends scope and top, and is idle without an exam id', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/exams/e-1/documents/merit-candidates', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    const idle = renderHookWithProviders(() => useMeritCandidates(undefined), opts);
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(
      () => useMeritCandidates('e-1', { scope: 'SECTION', top: 5 }),
      opts,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?scope=SECTION&top=5');
  });

  it('useTabulation sends section_id and waits for both ids', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/exams/e-1/documents/tabulation', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ rows: [], subjects: [] });
      }),
    );
    const idle = renderHookWithProviders(() => useTabulation('e-1', undefined), opts);
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => useTabulation('e-1', 'sec-1'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?section_id=sec-1');
  });

  it('useTranscript sends academic_year_id and waits for both ids', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/students/st-1/transcript', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ exams: [] });
      }),
    );
    const idle = renderHookWithProviders(() => useTranscript('st-1', undefined), opts);
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => useTranscript('st-1', 'y-1'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?academic_year_id=y-1');
  });
});

describe('exam document actions', () => {
  it('logDocumentPrint posts the body and resolves on 204', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/students/st-1/document-prints', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setActiveTenant('tenant-1');
    await expect(
      logDocumentPrint('st-1', { document: 'REPORT_CARD', exam_id: 'e-1' }),
    ).resolves.toBeUndefined();
    expect(body).toEqual({ document: 'REPORT_CARD', exam_id: 'e-1' });
  });

  it('printFamilyAdmitCard rejects with ADMIT_CARD_WITHHELD details on a 409', async () => {
    server.use(
      http.post('/api/v1/students/st-1/exams/e-1/admit-card', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'withheld',
            requestId: 'req-1',
            details: { code: 'ADMIT_CARD_WITHHELD' },
          },
          { status: 409 },
        ),
      ),
    );
    setActiveTenant('tenant-1');
    const error = await printFamilyAdmitCard('st-1', 'e-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details?.code).toBe('ADMIT_CARD_WITHHELD');
  });

  it('familyAdmitCardAssetBase builds the portal asset path', () => {
    expect(familyAdmitCardAssetBase('st-1', 'e-1')).toBe(
      '/students/st-1/exams/e-1/admit-card/assets',
    );
  });
});
