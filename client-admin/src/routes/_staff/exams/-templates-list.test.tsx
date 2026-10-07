import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const TEMPLATE = {
  id: 't1',
  name: 'Half-yearly',
  kind: 'TERM',
  rowCount: 28,
  classGrades: [8, 6, 7],
};
const SECOND = { id: 't2', name: 'Annual', kind: 'MODEL', rowCount: 3, classGrades: [9] };

function setup(list: unknown[]) {
  server.use(http.get('/api/v1/exam-templates', () => HttpResponse.json(list)));
  const user = userEvent.setup();
  const view = renderWithRouter(routeTree, {
    initialEntries: ['/exams/templates'],
    locale: 'en',
    tenantId: 'school-1',
    role: 'ADMIN',
  });
  return { ...view, user };
}

describe('TemplatesList (exam structures)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the title, the subtitle and one primary add button', async () => {
    setup([TEMPLATE]);
    await screen.findByRole('heading', { name: 'Exam structures' });
    expect(
      screen.getByText(
        'Set the parts and marks of each class and subject once; pick the structure when you create an exam.',
      ),
    ).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add exam structure' });
    expect(add.getAttribute('data-variant')).toBe('default');
  });

  it('shows the empty state with only the header add button', async () => {
    setup([]);
    expect(await screen.findByText('No exam structures yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add exam structure' })).toHaveLength(1);
  });

  it('lists structures with type, sorted classes in tenant digits and the subject count', async () => {
    setup([TEMPLATE, SECOND]);
    const row = (await screen.findByText('Half-yearly')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Term')).toBeTruthy();
    expect(within(row).getByText('৬, ৭, ৮')).toBeTruthy();
    expect(within(row).getByText('২৮')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe(
      '/exams/templates/t1',
    );
    // Unpaginated: a total, no rows-per-page control.
    expect(screen.queryByText('Rows per page')).toBeNull();
    expect(screen.getByText(/Total/)).toBeTruthy();
  });

  it('delete asks for confirmation and only deletes on confirm', async () => {
    const deleted = vi.fn();
    server.use(
      http.delete('/api/v1/exam-templates/t1', () => {
        deleted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = setup([TEMPLATE]);
    await user.click(await screen.findByRole('button', { name: 'Delete Half-yearly' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete this exam structure?')).toBeTruthy();
    expect(deleted).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(deleted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Half-yearly' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
  });
});
