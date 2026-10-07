import {
  attendanceKeys,
  myClassSectionsQueryOptions,
  paymentKeys,
  publicHolidaySetQueryOptions,
  resultDetailKey,
  schoolsKeys,
  surveyKeys,
} from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  createTestQueryClient,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_CRUMBS, type RouteCrumbs } from './route-crumbs';
import { routeTree } from './routeTree.gen';
import { ENTITY_RESOLVERS } from './use-breadcrumbs';

/**
 * [30.3.3] — `use-breadcrumbs.ts` wired into the real `_staff.tsx` shell,
 * exercised through the real route tree (`routeTree.gen.ts`) rather than
 * a synthetic harness, same reasoning `$studentId.test.tsx`'s own header
 * comment gives: a hook whose whole job is reading real route matches
 * and a real react-query cache needs a real route tree and a real
 * (mocked-at-the-network-boundary) query, not a prop change.
 */
describe('useBreadcrumbs (wired into _staff.tsx)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a three-level route (students list · student · edit) builds three crumb items', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const nav = await screen.findByRole('navigation', { name: 'You are here' });
    const crumbItems = within(nav).getAllByRole('listitem');
    expect(crumbItems).toHaveLength(3);
    // Last crumb is the current page, rendered as text (`aria-current`),
    // not a link — `Breadcrumbs`' own contract.
    await waitFor(() => expect(within(nav).getByText('Rahim Uddin')).toBeTruthy());
  });

  it('a $param route shows a skeleton + the generic noun (never the id) before the entity loads, then the name', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    let resolveStudent!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveStudent = resolve;
    });
    server.use(
      http.get('/api/v1/students/:id', async () => {
        await gate;
        return HttpResponse.json(student);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const nav = await screen.findByRole('navigation', { name: 'You are here' });
    // Loader hasn't resolved yet — a skeleton bar with the singular noun as sr-only text.
    await waitFor(() => expect(within(nav).getByText('Student').className).toContain('sr-only'));
    expect(within(nav).queryByText('student-1')).toBeNull();
    expect(nav.querySelector('[aria-hidden="true"].bg-muted')).not.toBeNull();
    // C5: while loading the tab title uses the parent label.
    expect(document.title).toBe('Students · SchoolManager');

    resolveStudent();

    await waitFor(() => expect(within(nav).getByText('Rahim Uddin')).toBeTruthy());
    expect(within(nav).queryByText('student-1')).toBeNull();
  });

  describe('cache-prefix resolvers', () => {
    /** Mirrors `useCachedEntityName`'s read without rendering a page. */
    function nameFor(
      queryClient: ReturnType<typeof createTestQueryClient>,
      entityKey: string,
      params: Record<string, string>,
      language = 'en',
      numerals: 'latin' | 'bengali' = 'latin',
    ): string | undefined {
      const resolver = ENTITY_RESOLVERS[entityKey]!;
      const id = resolver.param ? params[resolver.param]! : Object.values(params)[0]!;
      for (const key of resolver.queryKeys(id, params)) {
        for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
          const name = resolver.getName(data, id, {
            language,
            region: { ...REGION_BD_EN, numerals },
          });
          if (name) return name;
        }
      }
      return undefined;
    }

    const base = { tenantId: 'tenant-1', locale: 'en' } as const;

    async function lastCrumb(): Promise<string> {
      const nav = await screen.findByRole('navigation', { name: 'You are here' });
      const items = within(nav).getAllByRole('listitem');
      return items[items.length - 1]!.textContent ?? '';
    }

    it('a route with no resolver shows the noun, not the id', async () => {
      renderWithRouter(routeTree, {
        ...base,
        role: 'ADMIN',
        initialEntries: ['/promotions/run-77'],
      });
      await waitFor(async () => expect(await lastCrumb()).toBe('Promotion list'));
      expect(screen.queryByText('run-77')).toBeNull();
    });

    it('attendance section: the register prefix read resolves from the id alone', () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData([...attendanceKeys.all, 'register', 'sec-1', '2026-10-04', null], {
        section: { class_name: 'Class 6', section_name: 'A' },
      });
      expect(nameFor(queryClient, 'section', { sectionId: 'sec-1' })).toBe('Class 6 – A');
    });

    it('report card: keyed by (examId, studentId) and named from the result detail', () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(resultDetailKey('e1', 's1'), { student: { full_name: 'Rafi Ahmed' } });
      expect(nameFor(queryClient, 'reportCard', { examId: 'e1', studentId: 's1' })).toBe(
        'Rafi Ahmed',
      );
    });

    it('payment: student name plus the date; a deleted student leaves only the date', () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(paymentKeys.detail('p1'), {
        student: { full_name: 'Rahim Uddin' },
        payment_date: '2026-09-09',
      });
      queryClient.setQueryData(paymentKeys.detail('p2'), { student: null, payment_date: '2026-09-09' });
      expect(nameFor(queryClient, 'paymentDetail', { id: 'p1' })).toMatch(/^Rahim Uddin — .*2026/);
      const dateOnly = nameFor(queryClient, 'paymentDetail', { id: 'p2' });
      expect(dateOnly).toMatch(/2026/);
      expect(dateOnly).not.toContain(' — ');
    });

    it('holiday set: country name and Bangla year in bn, Latin year in en', () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(publicHolidaySetQueryOptions('hs1').queryKey, {
        country: 'BD',
        year: 2026,
      } as never);
      expect(nameFor(queryClient, 'holidaySetDetail', { setId: 'hs1' }, 'bn', 'bengali')).toBe(
        'বাংলাদেশ ২০২৬',
      );
      expect(nameFor(queryClient, 'holidaySetDetail', { setId: 'hs1' }, 'en', 'latin')).toBe(
        'Bangladesh 2026',
      );
    });

    it('holiday set: a malformed country code falls back (undefined) instead of throwing', () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(publicHolidaySetQueryOptions('hs2').queryKey, {
        country: 'not a region!',
        year: 2026,
      } as never);
      expect(nameFor(queryClient, 'holidaySetDetail', { setId: 'hs2' })).toBeUndefined();
    });

    it('school: picks the row whose id matches from the schools list cache', async () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData([...schoolsKeys.lists(), {}], [
        { id: 'sc1', name: 'Alpha School' },
        { id: 'sc2', name: 'Beta School' },
      ]);
      renderWithRouter(routeTree, {
        ...base,
        role: 'SUPER_ADMIN',
        queryClient,
        initialEntries: ['/schools/sc2'],
      });
      await waitFor(async () => expect(await lastCrumb()).toBe('Beta School'));
    });

    it('my class: names the section from the list cache, and is a skeleton when empty', async () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(myClassSectionsQueryOptions().queryKey, [
        {
          section_id: 's1',
          class_id: 'c6',
          class_name: 'Class 6',
          section_name: 'B',
          assignment_type: 'CLASS_TEACHER',
        },
        {
          section_id: 's2',
          class_id: 'c7',
          class_name: 'Class 7',
          section_name: 'A',
          assignment_type: 'CLASS_TEACHER',
        },
      ]);
      const first = renderWithRouter(routeTree, {
        ...base,
        role: 'TEACHER',
        queryClient,
        initialEntries: ['/my-class/s2'],
      });
      await waitFor(async () => expect(await lastCrumb()).toBe('Class 7 – A'));
      first.unmount();
      renderWithRouter(routeTree, {
        ...base,
        role: 'TEACHER',
        queryClient: createTestQueryClient(),
        initialEntries: ['/my-class/s9'],
      });
      const nav = await screen.findByRole('navigation', { name: 'You are here' });
      expect(within(nav).getByText('Section').className).toContain('sr-only');
      expect(within(nav).queryByText('s9')).toBeNull();
    });

    it('survey: Staff › Evaluations (to the Surveys tab) › the survey title', async () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(surveyKeys.detail('sv1'), { title: 'Term survey' });
      renderWithRouter(routeTree, {
        ...base,
        role: 'ADMIN',
        queryClient,
        initialEntries: ['/staff/evaluations/surveys/sv1'],
      });
      const nav = await screen.findByRole('navigation', { name: 'You are here' });
      expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
      const evaluations = within(nav).getByRole('link', { name: 'Evaluations' });
      expect(evaluations.getAttribute('href')).toContain('/staff/evaluations');
      expect(evaluations.getAttribute('href')).toContain('tab=surveys');
      await waitFor(async () => expect(await lastCrumb()).toBe('Term survey'));
    });

    it('marks list: the last crumb is the static label, never loading', async () => {
      renderWithRouter(routeTree, {
        ...base,
        role: 'ADMIN',
        initialEntries: ['/marks/e1/s1/sub1'],
      });
      const nav = await screen.findByRole('navigation', { name: 'You are here' });
      expect(within(nav).getByText('Marks list').className).not.toContain('sr-only');
    });

    it('a one-crumb route renders no crumb row but still sets the title', async () => {
      renderWithRouter(routeTree, { ...base, role: 'ADMIN', initialEntries: ['/students'] });
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('navigation', { name: 'You are here' })).toBeNull();
      await waitFor(() => expect(document.title).toBe('Students · SchoolManager'));
    });
  });

  it('a route ROUTE_CRUMBS marks with no crumb reason yields an empty trail — no breadcrumb nav at all', async () => {
    vi.doMock('./route-crumbs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./route-crumbs')>();
      return {
        ...actual,
        ROUTE_CRUMBS: {
          ...actual.ROUTE_CRUMBS,
          '/_staff/dashboard': 'test: intentionally no crumb for this route',
        },
      };
    });
    vi.resetModules();
    const { routeTree: freshTree } = await import('./routeTree.gen');

    renderWithRouter(freshTree, {
      initialEntries: ['/dashboard'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'You are here' })).toBeNull();

    vi.doUnmock('./route-crumbs');
    vi.resetModules();
  });

  it("sets document.title from the trail, reversed and joined with ' · '", async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(document.title).toBe('Rahim Uddin · Students · SchoolManager'));
  });
});

describe('entity crumbs never show an id (D9)', () => {
  const entityRoutes = Object.entries(ROUTE_CRUMBS).filter(
    ([, trail]) => Array.isArray(trail) && trail.some((s) => s.dynamic === 'entity'),
  );

  it('finds the dynamic entity routes', () => {
    expect(entityRoutes.length).toBeGreaterThan(20);
  });

  it('a resolver for a multi-param route declares which param is the id', () => {
    for (const [routeId, trail] of entityRoutes) {
      if ((routeId.match(/\$/g) ?? []).length < 2) continue;
      const seg = (trail as RouteCrumbs).find((s) => s.dynamic === 'entity')!;
      const key = 'entity' in seg.label ? seg.label.entity : seg.label.key;
      const resolver = ENTITY_RESOLVERS[key];
      if (resolver) expect(resolver.param, `${routeId} resolver "${key}"`).toBeDefined();
    }
  });

  // Rendering ~40 whole pages just to read one crumb is slow and flaky, so this
  // checks the only two places a label can come from: the static noun (no id
  // possible) and the resolver, fed cache shapes that hold no usable name.
  it.each(entityRoutes.map(([routeId]) => routeId))(
    '%s: a resolver never returns the id as the label',
    (routeId) => {
      const seg = (ROUTE_CRUMBS[routeId] as RouteCrumbs).find((s) => s.dynamic === 'entity')!;
      const key = 'entity' in seg.label ? seg.label.entity : seg.label.key;
      const resolver = ENTITY_RESOLVERS[key];
      if (!resolver) return; // no resolver: the label is the static noun
      const params = Object.fromEntries(
        [...routeId.matchAll(/\$([A-Za-z]+)/g)].map(([, name]) => [name!, crypto.randomUUID()]),
      );
      const id = resolver.param ? params[resolver.param]! : Object.values(params)[0]!;
      const ctx = { language: 'en', region: REGION_BD_EN };
      for (const data of [{}, [], { student: {}, section: {}, applicant: {} }]) {
        const name = resolver.getName(data, id, ctx);
        expect(name ?? '', `${routeId} (${key})`).not.toContain(id);
      }
    },
  );
});
