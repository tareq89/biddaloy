import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// The big screens have their own tests. Here only the ROUTES are under test, so each page
// component is a stub that shows what the route handed it.
vi.mock('../../components/print/editor/template-editor', () => ({
  TemplateEditor: ({ templateId }: { templateId: string }) => (
    <div data-testid="editor">{templateId}</div>
  ),
}));
vi.mock('../../components/print/preview/print-preview', () => ({
  PrintPreview: ({ subjectIds }: { subjectIds: string[] }) => (
    <div data-testid="preview">{subjectIds.join(',')}</div>
  ),
}));
vi.mock('../../components/print/history/print-history-page', () => ({
  PrintHistoryPage: ({
    search,
    onSearchChange,
  }: {
    search: Record<string, unknown>;
    onSearchChange: (patch: Record<string, string | number | null>) => void;
  }) => (
    <div>
      <output data-testid="history-search">{JSON.stringify(search)}</output>
      <button type="button" onClick={() => onSearchChange({ outcome: 'OK' })}>
        {PICK_OK}
      </button>
    </div>
  ),
}));

const PICK_OK = 'pick-ok';
const DENIED = "You don't have access to this page.";
const SECTION_ID = '11111111-1111-4111-8111-111111111111';

const render = (path: string, role: UserRole = UserRole.ADMIN) =>
  renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

function setWidth(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('print routes [32.4.1]', () => {
  afterEach(async () => {
    setWidth(true);
    await cleanupTestState();
  });

  it('the editor renders without the app shell (no navigation landmark)', async () => {
    setWidth(true);
    render('/print-templates/t-1/edit');
    expect((await screen.findByTestId('editor')).textContent).toBe('t-1');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('the preview renders without the app shell too', async () => {
    render(`/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a,b`);
    expect((await screen.findByTestId('preview')).textContent).toBe('a,b');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('an ordinary staff route still has the shell', async () => {
    render('/reports/printables');
    await screen.findByTestId('history-search');
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  });

  it('refuses a role without the permission, and never mounts the tool', async () => {
    render('/print-templates/t-1/edit', UserRole.TEACHER);
    await waitFor(() => expect(screen.getByText(DENIED)).toBeTruthy());
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('refuses the preview to a role without DOCUMENT_PRINT', async () => {
    render(`/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a`, UserRole.TEACHER);
    await waitFor(() => expect(screen.getByText(DENIED)).toBeTruthy());
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('under 768 px shows the "open on a computer" gate instead of the editor', async () => {
    setWidth(false);
    render('/print-templates/t-1/edit');
    expect(await screen.findByText('Open this on a computer to design or print')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('a class_section_id is resolved to every student id in that section', async () => {
    server.use(
      http.get('/api/v1/students/ids', ({ request }) => {
        expect(new URL(request.url).searchParams.get('section_id')).toBe(SECTION_ID);
        return HttpResponse.json({ ids: ['s1', 's2', 's3'], total: 3 });
      }),
    );
    render(
      `/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&class_section_id=${SECTION_ID}`,
    );
    expect((await screen.findByTestId('preview')).textContent).toBe('s1,s2,s3');
  });

  it('history filters round-trip through the URL; a filter change resets to page 1', async () => {
    const { router } = render('/reports/printables?outcome=FAILED&page=2');
    const user = userEvent.setup();
    const shown = async () =>
      JSON.parse((await screen.findByTestId('history-search')).textContent ?? '{}');
    expect(await shown()).toMatchObject({ outcome: 'FAILED', page: 2 });

    await user.click(await screen.findByRole('button', { name: PICK_OK }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ outcome: 'OK' }));
    expect(router.state.location.search).not.toHaveProperty('page');
  });
});
