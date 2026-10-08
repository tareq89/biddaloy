import { setActiveTenant } from '@biddaloy/ui/api';
import { server } from '@biddaloy/ui/test';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunPrintDeps } from '../../components/print/preview/run-print';

import { FAMILY_PRINTER, printAdmitCard } from './-admit-card-print';

// Half an A4 high, so two cards fill one sheet (D28).
const definition = {
  page: { widthMm: 190, heightMm: 138, sides: ['front'] },
  front: { background: { assetId: 'art-1', print: true }, elements: [] },
};

const item = (n: number) => ({
  item_id: `i-${n}`,
  subject_id: 's-1',
  label: 'Fatima',
  values: {},
  copy_number: n,
  verify_url: `/v/${n}`,
  photo_url: null,
});

function setup() {
  const order: string[] = [];
  const deps = {
    // The real `createPrintJob` must be swapped out: the family POST goes through msw.
    createPrintJob: vi.fn(() => Promise.reject(new Error('staff endpoint must not be used'))),
    reprintPrintJob: vi.fn(),
    buildPrintDocument: vi.fn(() => {
      order.push('build');
      return Promise.resolve('<html></html>');
    }),
    openPrintWindow: vi.fn(async (prepare: () => Promise<string>, onError: (e: Error) => void) => {
      try {
        await prepare();
      } catch (e) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }),
    fetchBlob: vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'image/png' }))),
    fetchStatic: vi.fn(() => Promise.resolve(new Blob(['f']))),
    origin: 'https://school.example',
  } as unknown as RunPrintDeps;
  return { deps, order };
}

const base = (onError = vi.fn()) => ({
  studentId: 's-1',
  examId: 'e-1',
  tenantId: 'school-1',
  lang: 'bn',
  title: 'Admit card',
  onError,
});

describe('printAdmitCard', () => {
  beforeEach(() => setActiveTenant('school-1'));
  afterEach(() => setActiveTenant(null));

  it('posts the family job first, then fetches artwork from the family asset route and lays 2 cards on one A4 sheet', async () => {
    const { deps, order } = setup();
    server.use(
      http.post('/api/v1/students/s-1/exams/e-1/admit-card', () => {
        order.push('post');
        return HttpResponse.json({
          job_id: 'job-1',
          version: { id: 'v-1', definition },
          items: [item(1), item(2)],
        });
      }),
    );

    await printAdmitCard(base(), deps);

    expect(order).toEqual(['post', 'build']);
    expect(deps.createPrintJob).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fetchBlob).mock.calls.map((c) => c[0])).toContain(
      '/students/s-1/exams/e-1/admit-card/assets/art-1/file',
    );
    const built = vi.mocked(deps.buildPrintDocument).mock.calls[0]![0];
    expect(built.printer).toMatchObject({ type: FAMILY_PRINTER.printer_type, scale: 1 });
    expect(FAMILY_PRINTER.printer_type).toBe('OFFICE');
    expect(built.sheets).toHaveLength(1);
  });

  it('a 409 reaches onError and nothing is built', async () => {
    const { deps } = setup();
    const onError = vi.fn();
    server.use(
      http.post('/api/v1/students/s-1/exams/e-1/admit-card', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'withheld',
            details: { code: 'ADMIT_CARD_WITHHELD' },
            requestId: 'r',
            path: '/',
            timestamp: 't',
          },
          { status: 409 },
        ),
      ),
    );

    await printAdmitCard(base(onError), deps);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ details: { code: 'ADMIT_CARD_WITHHELD' } }),
    );
    expect(deps.buildPrintDocument).not.toHaveBeenCalled();
    expect(deps.fetchBlob).not.toHaveBeenCalled();
  });
});
