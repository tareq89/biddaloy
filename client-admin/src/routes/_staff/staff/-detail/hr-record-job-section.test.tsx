import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordJobSection } from './hr-record-job-section';

/**
 * [23.9] Job info is the one HR-record section with logic of its own —
 * create-vs-update, `'' -> null` clearing on update vs omit-on-create, an
 * inline save error — so unlike the 7 identical `RepeatableRowForm`
 * wrappers (which lean on `hr-record-family-section.test.tsx` as their
 * representative, per D3) it gets its own file.
 *
 * Every field is null here on purpose: it pins the `?? ''` fallbacks that
 * `hr-record-tab.test.tsx`'s fixture (index_no + department set) never
 * reaches, and gives the update payload both a kept value and cleared ones.
 */
const RECORD = {
  id: 'hr-1',
  user_id: 'user-1',
  index_no: null,
  salary_code: null,
  mpo_date: null,
  salary_scale: null,
  department: null,
  blood_group: null,
  name_bn: null,
  religion: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const renderSection = () =>
  renderWithProviders(<HrRecordJobSection userId="user-1" />, {
    locale: 'en',
    tenantId: 'tenant-1',
    role: 'ADMIN',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordJobSection', () => {
  it('creates the first record from the empty state, omitting untouched fields', async () => {
    let postBody: unknown;
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])),
      http.post('/api/v1/staff-hr-records', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...RECORD, department: 'Science' });
      }),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add job details' }));
    await user.type(screen.getByLabelText('Department'), 'Science');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Omitted, not null: there is no existing value to clear yet
    // (`exactOptionalPropertyTypes` note in the section itself).
    await waitFor(() => expect(postBody).toEqual({ user_id: 'user-1', department: 'Science' }));
  });

  it('updates an existing record, sending every cleared field as null', async () => {
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([RECORD])),
      http.patch('/api/v1/staff-hr-records/hr-1', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...RECORD, department: 'Science' });
      }),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Department'), 'Science');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Explicit nulls, not omissions — omitting would leave the server's
    // current value in place instead of clearing it.
    await waitFor(() =>
      expect(patchBody).toEqual({
        index_no: null,
        salary_code: null,
        mpo_date: null,
        salary_scale: null,
        department: 'Science',
        blood_group: null,
        name_bn: null,
        religion: null,
      }),
    );
  });

  it('saves the Bangla name (name_bn) when the record is first created', async () => {
    let postBody: unknown;
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([])),
      http.post('/api/v1/staff-hr-records', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...RECORD, name_bn: 'রহিম উদ্দিন' });
      }),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add job details' }));
    await user.type(screen.getByLabelText('Name (Bangla)'), 'রহিম উদ্দিন');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(postBody).toEqual({ user_id: 'user-1', name_bn: 'রহিম উদ্দিন' }));
  });

  it('clears the Bangla name with an explicit null when the box is emptied', async () => {
    let patchBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/staff-hr-records', () =>
        HttpResponse.json([{ ...RECORD, name_bn: 'রহিম উদ্দিন' }]),
      ),
      http.patch('/api/v1/staff-hr-records/hr-1', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(RECORD);
      }),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText<HTMLInputElement>('Name (Bangla)').value).toBe('রহিম উদ্দিন');
    await user.clear(screen.getByLabelText('Name (Bangla)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Omitting the key would leave the old name in place; the server needs an explicit null.
    await waitFor(() => expect(patchBody?.name_bn).toBeNull());
  });

  it('shows an inline error and keeps the form open when the save fails', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([RECORD])),
      http.patch('/api/v1/staff-hr-records/hr-1', () =>
        HttpResponse.json({ message: 'boom' }, { status: 400 }),
      ),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Department'), 'Science');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Still editable, and still holding what was typed — a failed save must
    // not silently discard the user's input.
    expect(screen.getByLabelText<HTMLInputElement>('Department').value).toBe('Science');
  });

  it('shows the saving label while the save is in flight', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () => HttpResponse.json([RECORD])),
      http.patch('/api/v1/staff-hr-records/hr-1', async () => {
        // 400ms, matching `record-payment-modal.test.tsx`'s own in-flight
        // case: long enough that the request is reliably still pending when
        // `findByRole` first polls, well inside the 5s `asyncUtilTimeout`.
        await delay(400);
        return HttpResponse.json(RECORD);
      }),
    );

    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Substring: `Button loading` appends an sr-only " Loading" to the
    // accessible name (ui/src/components/button.tsx:57-62).
    expect(await screen.findByRole('button', { name: /Saving/ })).toBeTruthy();
  });

  it('shows the MPO date as a long-form date, never the ISO string', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records', () =>
        HttpResponse.json([{ ...RECORD, mpo_date: '2020-01-01' }]),
      ),
    );

    renderSection();

    expect(
      await screen.findByText(formatDate(parseServerDate('2020-01-01'), REGION_BD_BN)),
    ).toBeTruthy();
    expect(screen.queryByText('2020-01-01')).toBeNull();
  });
});
