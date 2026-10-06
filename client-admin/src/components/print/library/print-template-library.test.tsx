import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import type { PrintSuggestion, PrintTemplateRow } from '@biddaloy/ui/hooks';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintTemplateLibrary } from './print-template-library';

const template = (over: Partial<PrintTemplateRow> = {}): PrintTemplateRow => ({
  id: 't-1',
  name: 'Classic',
  document_kind: 'STUDENT_ID_CARD',
  layout_kind: 'FIXED',
  is_default: true,
  batch_size: 50,
  current_version_id: 'v-1',
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-02T00:00:00.000Z',
  ...over,
});

const suggestion = (over: Partial<PrintSuggestion> = {}): PrintSuggestion => ({
  key: 'student-portrait-classic',
  documentKind: 'STUDENT_ID_CARD',
  orientation: 'portrait',
  style: 'classic',
  nameKey: 'print.suggestion.student_portrait_classic',
  ...over,
});

const svg = () =>
  HttpResponse.text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', {
    headers: { 'Content-Type': 'image/svg+xml' },
  });

function serve(templates: PrintTemplateRow[], suggestions: PrintSuggestion[] = []) {
  server.use(
    http.get('/api/v1/print-templates', () => HttpResponse.json(templates)),
    http.get('/api/v1/print-templates/suggestions', () => HttpResponse.json(suggestions)),
    http.get('/api/v1/print-templates/suggestions/:key/artwork/:side', svg),
  );
}

const render = (role = 'ADMIN') => {
  const onEdit = vi.fn();
  const view = renderWithProviders(<PrintTemplateLibrary onEdit={onEdit} />, {
    locale: 'en',
    role,
    tenantId: 'school-1',
  });
  return { ...view, onEdit };
};

describe('PrintTemplateLibrary', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists templates grouped by document type, student cards before staff cards', async () => {
    serve([
      template({
        id: 't-2',
        name: 'Staff Modern',
        document_kind: 'STAFF_ID_CARD',
        is_default: false,
      }),
      template({ id: 't-1', name: 'Student Classic' }),
    ]);
    render();

    await screen.findAllByText('Student Classic');
    const names = screen
      .getAllByRole('row')
      .map((r) => r.textContent ?? '')
      .filter((text) => /Student Classic|Staff Modern/.test(text));
    expect(names[0]).toContain('Student Classic');
    expect(names[1]).toContain('Staff Modern');
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
  });

  it('offers "Make default" only for a published template that is not already the default', async () => {
    serve([
      template({ id: 'a', name: 'Default one' }),
      template({ id: 'b', name: 'Published two', is_default: false }),
      template({ id: 'c', name: 'Draft three', is_default: false, current_version_id: null }),
    ]);
    render();

    await screen.findAllByText('Published two');
    const rowOf = (name: string) =>
      screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes(name))!;
    const has = (name: string) =>
      within(rowOf(name)).queryByRole('button', { name: 'Make default' }) !== null;
    expect(has('Published two')).toBe(true);
    expect(has('Draft three')).toBe(false); // unpublished
    expect(has('Default one')).toBe(false); // already default
  });

  it('archiving the default (409) shows a translated toast, never the server sentence', async () => {
    serve([template()]);
    server.use(
      http.post('/api/v1/print-templates/t-1/archive', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Choose another default first',
            timestamp: new Date().toISOString(),
            path: '/api/v1/print-templates/t-1/archive',
            requestId: 'r-1',
          },
          { status: 409 },
        ),
      ),
    );
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    const { user } = render();
    await screen.findAllByText('Classic');

    await user.click(screen.getAllByRole('button', { name: /^Archive/ })[0]!);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'This is the default design. Make another design the default first.',
      ),
    );
    expect(screen.queryByText('Choose another default first')).toBeNull();
    error.mockRestore();
  });

  it('shows no pager, a "Total 2" footer and a Default badge in the name cell', async () => {
    serve([
      template(),
      template({ id: 't-2', name: 'Other', is_default: false, current_version_id: null }),
    ]);
    render();

    await screen.findAllByText('Other');
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull();
    expect(screen.getAllByText(`Total ${formatNumber(2, REGION_BD_BN)}`).length).toBeGreaterThan(0);
    const row = screen.getAllByRole('row').find((r) => /Classic/.test(r.textContent ?? ''))!;
    expect(within(row).getByText('Default')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^Make default/ })).toBeNull();
    expect(within(row).getByText('Published')).toBeTruthy();
    const draft = screen.getAllByRole('row').find((r) => /Other/.test(r.textContent ?? ''))!;
    expect(within(draft).getByText('Draft only')).toBeTruthy();
  });

  it('"New design" opens the dialog', async () => {
    serve([template()], [suggestion()]);
    const { user } = render();
    await screen.findAllByText('Classic');

    await user.click(screen.getByRole('button', { name: 'New design' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('make default asks first, then calls the endpoint', async () => {
    serve([template({ id: 'b', name: 'Published two', is_default: false })]);
    let called = false;
    server.use(
      http.post('/api/v1/print-templates/b/default', () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = render();
    await screen.findAllByText('Published two');

    await user.click(screen.getAllByRole('button', { name: /^Make default/ })[0]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(called).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Make default' }));

    await waitFor(() => expect(called).toBe(true));
  });

  it('shows the batch size in Bangla digits under the bn locale', async () => {
    serve([template()]);
    renderWithProviders(<PrintTemplateLibrary onEdit={vi.fn()} />, {
      locale: 'bn',
      role: 'ADMIN',
      tenantId: 'school-1',
    });
    expect(await screen.findAllByText('৫০')).not.toHaveLength(0);
  });

  it('with no templates, shows the designs inline under "Start from a design"', async () => {
    serve(
      [],
      [
        suggestion(),
        suggestion({ key: 'student-landscape-modern', orientation: 'landscape', style: 'modern' }),
        suggestion({ key: 'staff-portrait-classic', documentKind: 'STAFF_ID_CARD' }),
      ],
    );
    render();

    expect(await screen.findByText('Start from a design')).toBeTruthy();
    expect(await screen.findAllByRole('button', { name: /Classic · portrait/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Modern · landscape/ })).toBeTruthy();
  });

  it('a design in the empty state opens the new-template dialog with it already chosen', async () => {
    serve([], [suggestion()]);
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: /Classic · portrait/ }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    const name = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(name.value).toBe('Classic portrait ID card');
  });

  it('opens the new-template dialog when the page asks to (openNewDialog)', async () => {
    serve([template()], [suggestion()]);
    renderWithProviders(<PrintTemplateLibrary onEdit={vi.fn()} openNewDialog />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Choose a design')).toBeTruthy());
  });

  it('hides creating, defaulting and archiving from a role that cannot manage templates', async () => {
    serve([template({ is_default: false })]);
    render('ACCOUNTANT');

    await screen.findAllByText('Classic');
    expect(screen.queryByRole('button', { name: 'New design' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Archive/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Make default/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Edit/ }).length).toBeGreaterThan(0);
  });
});
