import '@biddaloy/ui/test';
import type { SchoolLabels } from '@biddaloy/shared';
import { Toaster } from '@biddaloy/ui/components';
import { i18n, useTranslation } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WordsTab } from './WordsTab';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

/** A profile whose labels the test controls; PATCH bodies are recorded. */
function mockApi(labels: SchoolLabels = {}) {
  let state = labels;
  const patch = vi.fn<(body: unknown) => void>();
  const profileGets = vi.fn();
  server.use(
    http.get('/api/v1/schools/me/profile', () => {
      profileGets();
      return HttpResponse.json({ name: 'S', slug: 's', modules: {}, labels: state });
    }),
    http.patch('/api/v1/schools/school-1/settings', async ({ request }) => {
      const body = (await request.json()) as { labels: SchoolLabels };
      patch(body);
      state = { ...state, ...body.labels };
      return HttpResponse.json({ version: 1 });
    }),
  );
  return { patch, profileGets };
}

/** Stands in for any page title that uses the section word. */
function SectionTitle() {
  const { t } = useTranslation('common');
  return <h1>{t('entities.section', { count: 1, lng: 'en' })}</h1>;
}

const renderTab = () =>
  renderWithProviders(
    <>
      <SectionTitle />
      <WordsTab schoolId="school-1" />
      <Toaster />
    </>,
    opts,
  );
const field = (key: string, f: 'one' | 'other' | 'bn') =>
  document.getElementById(`word-${key}-${f}`) as HTMLInputElement;

describe('WordsTab', () => {
  // The words a save applies live on the shared i18n instance; put the stock ones back.
  afterEach(async () => {
    i18n.addResource('en', 'common', 'entities.section_one', 'Section');
    i18n.addResource('en', 'common', 'entities.section_other', 'Sections');
    for (const f of ['one', 'other'])
      i18n.addResource('bn', 'common', `entities.section_${f}`, 'শাখা');
    await cleanupTestState();
  });

  it('lists the five renamable words, never shift, version or group', async () => {
    mockApi();
    renderTab();
    await screen.findByRole('button', { name: 'ব্যাচ / Batch' });

    for (const k of ['class', 'section', 'student', 'guardian', 'teacher']) {
      expect(field(k, 'one')).toBeTruthy();
    }
    for (const k of ['shift', 'version', 'group']) expect(field(k, 'one')).toBeNull();
    expect(field('section', 'one').value).toBe('Section');
    expect(field('section', 'other').value).toBe('Sections');
  });

  it('a suggestion fills the row and the example updates live', async () => {
    mockApi();
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'ব্যাচ / Batch' }));

    expect(field('section', 'one').value).toBe('Batch');
    expect(field('section', 'other').value).toBe('Batches');
    expect(field('section', 'bn').value).toBe('ব্যাচ');
    expect(screen.getByText('3 Batches')).toBeTruthy();
    await userEvent.clear(field('section', 'other'));
    await userEvent.type(field('section', 'other'), 'Groups');
    expect(screen.getByText('3 Groups')).toBeTruthy();
  });

  it('Save sends one PATCH with only the changed row, then the page word changes', async () => {
    const { patch, profileGets } = mockApi();
    renderTab();
    await screen.findByRole('heading', { name: 'Section' });
    await userEvent.click(await screen.findByRole('button', { name: 'ব্যাচ / Batch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith({
      version: 1,
      labels: { section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' } },
    });
    // The profile is read again, so applyTenantWords re-renders the page word.
    await waitFor(() => expect(profileGets.mock.calls.length).toBeGreaterThanOrEqual(2));
    await screen.findByRole('heading', { name: 'Batch' });
    expect(await screen.findByText('Words saved')).toBeTruthy();
  });

  it('a row left blank everywhere sends the key as null (the stock word)', async () => {
    const { patch } = mockApi({
      section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' },
    });
    renderTab();
    await screen.findByRole('heading', { name: 'Batch' });
    for (const f of ['one', 'other', 'bn'] as const) await userEvent.clear(field('section', f));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith({ version: 1, labels: { section: null } });
  });

  it('a half-cleared row blocks Save, says why, and sends nothing', async () => {
    const { patch } = mockApi({
      section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' },
    });
    renderTab();
    await screen.findByRole('heading', { name: 'Batch' });
    await userEvent.clear(field('section', 'bn'));
    const msg = await screen.findByRole('alert');
    expect(msg.textContent).toBe(
      'Fill all three words, or clear the whole row to go back to the stock word',
    );
    expect(field('section', 'bn').getAttribute('aria-invalid')).toBe('true');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(save);
    expect(patch).not.toHaveBeenCalled();
  });

  it('changing one word sends only that word (the server merges per word)', async () => {
    const { patch } = mockApi();
    renderTab();
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.clear(field('teacher', 'bn'));
    await userEvent.type(field('teacher', 'bn'), 'গুরু');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith({ version: 1, labels: { teacher: { bn: 'গুরু' } } });
  });

  it('41 characters blocks the save and says why under the field', async () => {
    const { patch } = mockApi();
    renderTab();
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.clear(field('class', 'one'));
    await userEvent.type(field('class', 'one'), 'x'.repeat(41));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Use 1 to 40 characters, with no < or >.');
    expect(field('class', 'one').getAttribute('aria-invalid')).toBe('true');
    expect(patch).not.toHaveBeenCalled();
  });

  it('a failed save keeps the typed words, says so, and is not retried', async () => {
    mockApi();
    const calls = vi.fn();
    server.use(
      http.patch('/api/v1/schools/school-1/settings', () => {
        calls();
        return HttpResponse.json(
          { statusCode: 400, message: 'no', requestId: 'r' },
          { status: 400 },
        );
      }),
    );
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'ব্যাচ / Batch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Not saved — try again');
    expect(field('section', 'one').value).toBe('Batch');
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('shows a typed word as text, not markup', async () => {
    mockApi();
    renderTab();
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.clear(field('class', 'other'));
    await userEvent.type(field('class', 'other'), '<b>Hi</b>');

    expect(screen.getByText('3 <b>Hi</b>')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
  });
});
