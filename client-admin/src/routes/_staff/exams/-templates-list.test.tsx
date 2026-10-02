import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplatesList } from './-templates-list';

const TEMPLATE = { id: 't1', name: 'Half-yearly', kind: 'TERM', rowCount: 3, classGrades: [5, 6] };

function setup(list: unknown[]) {
  server.use(http.get('/api/v1/exam-templates', () => HttpResponse.json(list)));
  const user = userEvent.setup();
  const view = renderWithProviders(<TemplatesList onCreated={vi.fn()} />, {
    locale: 'en',
    tenantId: 'school-1',
    role: 'ADMIN',
  });
  return { ...view, user };
}

describe('TemplatesList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state', async () => {
    setup([]);
    expect(
      await screen.findByText('No templates yet — apply a curriculum preset or create one.'),
    ).toBeTruthy();
  });

  it('lists templates with kind, row count and grades; no axe violations', async () => {
    const { container } = setup([TEMPLATE]);
    expect(await screen.findByText('Half-yearly')).toBeTruthy();
    expect(screen.getAllByText('5, 6').length).toBeGreaterThan(0);
    await expect(container).toHaveNoViolations();
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
    await user.click(await screen.findByRole('button', { name: 'Delete template Half-yearly' }));
    expect(await screen.findByText('Delete template?')).toBeTruthy();
    expect(deleted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete template Half-yearly' }));
    await user.click(await screen.findByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
  });
});
