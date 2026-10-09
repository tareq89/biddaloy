import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const {
  CREATE_TEMPLATE,
  ADD_PRINTER,
  DONE,
  CLOSE,
  BACK,
  CANCEL,
  PICK_STAFF,
  PICK_SECTION,
  SECTION_ID,
} = vi.hoisted(() => ({
  CREATE_TEMPLATE: 'create-template',
  ADD_PRINTER: 'add-printer',
  DONE: 'done',
  CLOSE: 'close-preview',
  BACK: 'back-to-picker',
  CANCEL: 'cancel-picker',
  PICK_STAFF: 'pick-staff',
  PICK_SECTION: 'pick-section',
  SECTION_ID: '11111111-1111-4111-8111-111111111111',
}));

// The big screens have their own tests. Here only the ROUTES are under test, so each page
// component is a stub that shows what the route handed it.
vi.mock('../../components/print/editor/template-editor', () => ({
  TemplateEditor: ({ templateId }: { templateId: string }) => (
    <div data-testid="editor">{templateId}</div>
  ),
}));
vi.mock('../../components/print/preview/print-preview', () => ({
  PrintPreview: (props: {
    documentKind: string;
    subjectType: string;
    subjectIds: string[];
    onCreateTemplate: () => void;
    onAddPrinter: () => void;
    onDone: () => void;
    onClose: () => void;
    onBack?: () => void;
  }) => (
    <div>
      <div data-testid="preview">{props.subjectIds.join(',')}</div>
      <output data-testid="preview-kind">{`${props.documentKind}/${props.subjectType}`}</output>
      <button type="button" onClick={props.onCreateTemplate}>
        {CREATE_TEMPLATE}
      </button>
      <button type="button" onClick={props.onAddPrinter}>
        {ADD_PRINTER}
      </button>
      <button type="button" onClick={props.onDone}>
        {DONE}
      </button>
      <button type="button" onClick={props.onClose}>
        {CLOSE}
      </button>
      {props.onBack ? (
        <button type="button" onClick={props.onBack}>
          {BACK}
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock('../../components/print/print-id-card-modal', () => ({
  PrintIdCardModal: (props: {
    initialType: string;
    onClose: () => void;
    onConfirm: (
      c:
        | { subjectType: 'STUDENT' | 'STAFF'; ids: string }
        | { subjectType: 'STUDENT'; classSectionId: string },
    ) => void;
  }) => (
    <div>
      <output data-testid="picker-type">{props.initialType}</output>
      <button type="button" onClick={props.onClose}>
        {CANCEL}
      </button>
      <button type="button" onClick={() => props.onConfirm({ subjectType: 'STAFF', ids: 'u1,u2' })}>
        {PICK_STAFF}
      </button>
      <button
        type="button"
        onClick={() => props.onConfirm({ subjectType: 'STUDENT', classSectionId: SECTION_ID })}
      >
        {PICK_SECTION}
      </button>
    </div>
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
    expect(await screen.findByText('Open this on a computer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('under 768 px the preview route shows the gate frame with Close, and mounts neither step', async () => {
    setWidth(false);
    render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a');
    expect(await screen.findByText('Open this on a computer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByTestId('preview')).toBeNull();
    expect(screen.queryByTestId('picker-type')).toBeNull();
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

  it('with nobody chosen it shows the picker, for the type in the URL', async () => {
    render('/print/preview?kind=STAFF_ID_CARD&subject_type=STAFF');
    expect((await screen.findByTestId('picker-type')).textContent).toBe('STAFF');
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('the picker hands its choice back to the URL: people become ids, a section becomes class_section_id', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['x1'], total: 1 })),
    );
    const { router } = render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: PICK_STAFF }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        kind: 'STAFF_ID_CARD',
        subject_type: 'STAFF',
        ids: 'u1,u2',
      }),
    );
    expect((await screen.findByTestId('preview')).textContent).toBe('u1,u2');
  });

  it('a section choice turns into class_section_id', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['x1', 'x2'], total: 2 })),
    );
    const { router } = render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT');
    await userEvent.setup().click(await screen.findByRole('button', { name: PICK_SECTION }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ class_section_id: SECTION_ID }),
    );
    expect((await screen.findByTestId('preview')).textContent).toBe('x1,x2');
  });

  it("the picker's choice replaces history and marks pick=1, so the preview offers Back to the picker", async () => {
    const { router } = render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: PICK_STAFF }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pick: '1' }));
    await user.click(await screen.findByRole('button', { name: BACK }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('ids'));
    expect(router.state.location.search).not.toHaveProperty('pick');
    expect(await screen.findByTestId('picker-type')).toBeTruthy();
  });

  it('a preview opened with ids directly has no Back, and Close goes to from', async () => {
    const { router } = render(
      '/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a&from=%2Fstudents',
    );
    const user = userEvent.setup();
    await screen.findByTestId('preview');
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();
    await user.click(screen.getByRole('button', { name: CLOSE }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('cancelling the picker goes back to where the user came from', async () => {
    const { router } = render(
      '/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&from=%2Fstudents',
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: CANCEL }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('a bad kind falls back to student cards, and an off-site "from" is ignored', async () => {
    const { router } = render(
      '/print/preview?kind=NOPE&subject_type=WHAT&ids=a&from=https%3A%2F%2Fevil.example',
    );
    expect((await screen.findByTestId('preview-kind')).textContent).toBe('STUDENT_ID_CARD/STUDENT');
    await userEvent.setup().click(screen.getByRole('button', { name: DONE }));
    // `/` itself redirects to the dashboard; the point is that it stayed on this site.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('a backslash-prefixed "from" is ignored too (pushState would throw on it)', async () => {
    const { router } = render(
      '/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a&from=%2F%5Cevil.example',
    );
    await screen.findByTestId('preview');
    await userEvent.setup().click(screen.getByRole('button', { name: DONE }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('the preview\'s "no template" and "no printer" actions go to the right places', async () => {
    const { router } = render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: ADD_PRINTER }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.location.hash).toBe('printers-section');
  });

  it('"create a template" opens the library with the new-template dialog requested', async () => {
    const { router } = render('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=a');
    await userEvent.setup().click(await screen.findByRole('button', { name: CREATE_TEMPLATE }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/print-templates'));
    expect(router.state.location.search).toMatchObject({ new: '1' });
  });
});
