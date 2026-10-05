import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const CLASS_1 = '11111111-1111-4111-8111-111111111111';
const CLASS_2 = '22222222-2222-4222-8222-222222222222';

function mockClasses(classes: { id: string; name: string }[]) {
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: classes.map((klass) => ({
          ...classFactory(klass),
          section_count: 1,
          student_count: 40,
        })),
        total: classes.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

function mockSections(classId: string, className: string, names: string[]) {
  const klass = classFactory({ id: classId, name: className });
  server.use(
    http.get(`/api/v1/classes/${classId}/sections`, () =>
      HttpResponse.json(
        names.map((name, index) => ({
          ...classSectionFactory({
            id: `section-${name}`,
            class: klass,
            class_id: classId,
            section_name: name,
          }),
          enrolled_count: 40 + index,
        })),
      ),
    ),
  );
}

function render(entry = '/routines') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/routines', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the first class sections in a table, linking each into the builder', async () => {
    mockClasses([
      { id: CLASS_1, name: 'Class 6' },
      { id: CLASS_2, name: 'Class 7' },
    ]);
    mockSections(CLASS_1, 'Class 6', ['A', 'B']);
    render();

    const link = await screen.findByRole('link', { name: /Section A/ });
    expect(link.getAttribute('href')).toBe(`/routines/section-A?classId=${CLASS_1}`);
    expect(screen.getByRole('table', { name: 'Sections of Class 6' })).toBeTruthy();
    expect(screen.getByText('Total 2')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Arrange routine' })[0]?.getAttribute('href')).toBe(
      `/routines/section-A?classId=${CLASS_1}`,
    );
    expect(document.querySelector('select')).toBeNull();
  });

  it('picking another class puts it in the URL and lists its sections', async () => {
    mockClasses([
      { id: CLASS_1, name: 'Class 6' },
      { id: CLASS_2, name: 'Class 7' },
    ]);
    mockSections(CLASS_1, 'Class 6', ['A']);
    mockSections(CLASS_2, 'Class 7', ['C']);
    const { router } = render();

    const user = userEvent.setup();
    await screen.findByRole('link', { name: /Section A/ });
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));

    await screen.findByRole('link', { name: /Section C/ });
    expect(router.state.location.search).toEqual({ classId: CLASS_2 });
  });

  it('a class with no sections shows an empty state that opens the class', async () => {
    mockClasses([{ id: CLASS_1, name: 'Class 6' }]);
    mockSections(CLASS_1, 'Class 6', []);
    render();

    expect(await screen.findByRole('heading', { name: 'No sections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open class' })).toBeTruthy();
  });

  it('a school with no classes shows the no-classes empty state', async () => {
    mockClasses([]);
    render();

    expect(await screen.findByRole('heading', { name: 'No classes yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to classes' })).toBeTruthy();
  });

  it('a failed class load shows a retryable error', async () => {
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    render();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/Couldn't load the classes/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
