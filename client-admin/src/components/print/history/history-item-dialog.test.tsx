import '@biddaloy/ui/test';

import type { PrintHistoryItemDetail } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HistoryItemDialog } from './history-item-dialog';

const ASSET = '44444444-4444-4444-8444-444444444444';

const item = (over: Partial<PrintHistoryItemDetail> = {}): PrintHistoryItemDetail =>
  ({
    id: 'item-1',
    job_id: 'job-1',
    subject_type: 'STUDENT',
    subject_id: 's-1',
    subject_label: 'Rahim Uddin',
    document_kind: 'STUDENT_ID_CARD',
    copy_number: 2,
    outcome: 'OK',
    revoked_at: null,
    revoke_reason: null,
    created_at: '2027-03-01T10:00:00.000Z',
    printed_by_name: 'Accountant User',
    template_name: 'Classic',
    template_version: 1,
    data_snapshot: {
      values: {
        'student.name': 'Rahim Uddin',
        'school.logo': 'tenants/x/logo.png',
        n: 7,
        flag: true,
        nothing: null,
      },
      photoKey: 'tenants/x/student-photo/p.jpg',
      copyNumber: 2,
      issuedAt: '2027-03-01T10:00:00.000Z',
    },
    template_definition: {
      page: { widthMm: 85.6, heightMm: 54, sides: ['front', 'back'] },
      front: {
        background: { assetId: ASSET, print: true },
        elements: [
          {
            id: 't',
            type: 'TEXT',
            field: 'student.name',
            fontFamily: 'Biddaloy Sans',
            sizePt: 10,
            weight: 400,
            color: '#000000',
            align: 'left',
            overflow: 'SHRINK',
            x: 1,
            y: 1,
            w: 30,
            h: 6,
          },
        ],
      },
      back: { elements: [] },
    },
    ...over,
  }) as unknown as PrintHistoryItemDetail;

function serve(detail: PrintHistoryItemDetail | 'missing') {
  server.use(
    http.get('/api/v1/print-history/items/:id', () =>
      detail === 'missing'
        ? HttpResponse.json({ message: 'gone' }, { status: 404 })
        : HttpResponse.json(detail),
    ),
    http.get('/api/v1/print-jobs/photo', () =>
      HttpResponse.arrayBuffer(new Uint8Array([1, 2]).buffer, {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    ),
    http.get('/api/v1/schools/:id/logo', () =>
      HttpResponse.arrayBuffer(new Uint8Array([3]).buffer, {
        headers: { 'Content-Type': 'image/png' },
      }),
    ),
    http.get('/api/v1/print-assets/:id/file', () =>
      HttpResponse.arrayBuffer(new Uint8Array([4]).buffer, {
        headers: { 'Content-Type': 'image/png' },
      }),
    ),
  );
}

function open(props: Partial<React.ComponentProps<typeof HistoryItemDialog>> = {}) {
  return renderWithProviders(
    <HistoryItemDialog open onOpenChange={() => undefined} itemId="item-1" {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

describe('HistoryItemDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows who printed it, the copy, both sides and the QR note; a valid copy can be reprinted or revoked', async () => {
    serve(item());
    const onReprint = vi.fn();
    const onRevoke = vi.fn();
    const { user } = open({ onReprint, onRevoke });

    expect(await screen.findByText('Accountant User')).toBeTruthy();
    expect(screen.getByText('Front')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByText(/QR code is not stored/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reprint' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onReprint).toHaveBeenCalledOnce();
    expect(onRevoke).toHaveBeenCalledOnce();
  });

  it('a revoked copy shows the reason and offers no actions', async () => {
    serve(item({ revoked_at: '2027-03-02T00:00:00.000Z', revoke_reason: 'Lost card' }));
    open({ onReprint: vi.fn(), onRevoke: vi.fn() });
    expect(await screen.findByText('Lost card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('with no callbacks there are no buttons even for a valid copy', async () => {
    serve(item());
    open();
    await screen.findByText('Accountant User');
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
  });

  it('a card printed by nobody (a system job) and a staff card without a photo still render', async () => {
    serve(
      item({
        subject_type: 'STAFF',
        printed_by_name: null,
        data_snapshot: {
          values: { 'staff.name': 'Fatema' },
          photoKey: null,
          copyNumber: 1,
          issuedAt: '2027-03-01T00:00:00.000Z',
        },
      } as never),
    );
    open();
    await waitFor(() => expect(screen.getByText('System')).toBeTruthy());
  });

  it('says so when the item cannot be loaded', async () => {
    serve('missing');
    open();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('renders nothing while closed, or without an item id', () => {
    serve(item());
    open({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    open({ itemId: undefined });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
