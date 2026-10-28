import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ROWS = [
  {
    classGrade: 6,
    subjectCode: 'BAN',
    subjectName: 'Bangla',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
  {
    classGrade: 7,
    subjectCode: 'ENG',
    subjectName: 'English',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
];

/** [#2915] Leaving the exam structure page with an unsaved grid asks first. */
describe('/exams/templates/$templateId unsaved guard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mount() {
    server.use(
      http.get('/api/v1/exam-templates/:id', () =>
        HttpResponse.json({ id: 't1', name: 'Annual', kind: 'TERM', rows: ROWS }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }),
      ),
      http.get('/api/v1/presets/status', () => HttpResponse.json({ state: 'AVAILABLE' })),
    );
    return renderWithRouter(routeTree, {
      initialEntries: ['/exams/templates/t1?grade=6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  async function edit(user: ReturnType<typeof userEvent.setup>) {
    const name = await screen.findByLabelText(
      'Part name — BAN — Bangla, class 6, row 1',
      {},
      { timeout: 15000 },
    );
    await user.type(name, 'X');
    await screen.findByText('Not saved');
  }

  it('opens the leave dialog on navigation; Stay keeps the edit', async () => {
    const user = userEvent.setup();
    const { router } = mount();
    await edit(user);

    void router.navigate({ to: '/exams/templates' });
    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stay' }));

    expect(router.state.location.pathname).toBe('/exams/templates/t1');
    expect(screen.getByText('Not saved')).toBeTruthy();
  });

  it('does not open the dialog when only the class grade changes', async () => {
    const user = userEvent.setup();
    const { router } = mount();
    await edit(user);

    await router.navigate({
      to: '/exams/templates/$templateId',
      params: { templateId: 't1' },
      search: { grade: 7 },
    });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ grade: 7 }));
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});
