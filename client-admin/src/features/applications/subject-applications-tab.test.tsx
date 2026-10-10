import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import type { ApplicationListItemDto } from '@biddaloy/ui/hooks';
import {
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/**
 * [52.5.2] The tab is mounted through the real detail routes (`?tab=applications`), so the links
 * and the permission gate are the real ones.
 */
const APP_ID = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '8b7e0000-0000-4000-8000-000000000001';
const STAFF_PROFILE_ID = '5a5a0000-0000-4000-8000-000000000001';

const row = (extra: Partial<ApplicationListItemDto> = {}): ApplicationListItemDto =>
  ({
    id: APP_ID,
    serial: '2026/0045',
    serial_year: 2026,
    serial_no: 45,
    type: ApplicationType.STUDENT_LEAVE,
    status: ApplicationStatus.PENDING,
    source: 'APP',
    applicant_name: 'Karim Hossain',
    applicant_role: 'PARENT',
    subject_kind: 'STUDENT',
    subject_name: 'Rahim Uddin',
    payload: { reason: 'fever' },
    ref_names: {},
    start_date: '2026-10-08',
    end_date: '2026-10-09',
    created_at: '2026-10-07T04:00:00.000Z',
    can: { decide: false, consider: false, withdraw: false, cancel: false, comment: true },
    ...extra,
  }) as unknown as ApplicationListItemDto;

function mockList(
  rows: ApplicationListItemDto[] | 'forbidden',
  onList?: (url: URL) => void,
  total = Array.isArray(rows) ? rows.length : 0,
) {
  server.use(
    http.get('/api/v1/applications', ({ request }) => {
      onList?.(new URL(request.url));
      if (rows === 'forbidden')
        return HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/applications',
            requestId: 'req-1',
          },
          { status: 403 },
        );
      return HttpResponse.json({ data: rows, total, page: 1, limit: 100, totalPages: 1 });
    }),
  );
}

function mountStudent() {
  server.use(
    http.get('/api/v1/students/:id', () =>
      HttpResponse.json(studentFactory({ id: STUDENT_ID, full_name: 'Rahim Uddin' })),
    ),
  );
  return renderWithRouter(routeTree, {
    initialEntries: [`/students/${STUDENT_ID}?tab=applications`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

function mountStaff() {
  server.use(
    http.get('/api/v1/users/:id', () =>
      HttpResponse.json(
        userResponseFactory({
          id: 'user-1',
          full_name: 'Abdul Karim',
          staff_profile_id: STAFF_PROFILE_ID,
        }),
      ),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
    ),
  );
  return renderWithRouter(routeTree, {
    initialEntries: ['/staff/user-1?tab=applications'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('SubjectApplicationsTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('student subject: asks for view=all&student_id and shows serial, type, status', async () => {
    let url: URL | undefined;
    mockList([row()], (u) => (url = u));
    mountStudent();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('2026/0045')).toBeTruthy();
    expect(within(table).getByText('Student leave')).toBeTruthy();
    expect(within(table).getByText('Pending')).toBeTruthy();
    expect(within(table).getByText('Parent')).toBeTruthy();
    expect(url?.searchParams.get('view')).toBe('all');
    expect(url?.searchParams.get('student_id')).toBe(STUDENT_ID);
    expect(url?.searchParams.get('limit')).toBe('100');
  });

  it('staff subject: asks for staff_profile_id', async () => {
    let url: URL | undefined;
    mockList([row({ type: ApplicationType.STAFF_LEAVE })], (u) => (url = u));
    mountStaff();

    expect(await screen.findByText('Staff leave')).toBeTruthy();
    expect(url?.searchParams.get('staff_profile_id')).toBe(STAFF_PROFILE_ID);
    expect(url?.searchParams.get('student_id')).toBeNull();
  });

  it('staff subject: "Enter a paper application" lands on /applications/new with them pre-selected', async () => {
    // `?staff=` takes the USER id; the profile id would 404 on GET /users/:id and dead-end.
    const USER_ID = '7a000000-0000-4000-8000-0000000000cc';
    mockList([]);
    server.use(
      http.get('/api/v1/users/:id', ({ params }) =>
        HttpResponse.json(
          params.id === USER_ID
            ? userResponseFactory({
                id: USER_ID,
                full_name: 'Abdul Karim',
                staff_profile_id: STAFF_PROFILE_ID,
              })
            : userResponseFactory({ id: 'u-me', staff_profile_id: 'sp-me' }),
        ),
      ),
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          data: [{ id: USER_ID, full_name: 'Abdul Karim', staff_profile_id: STAFF_PROFILE_ID }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/staff/${USER_ID}?tab=applications`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Enter a paper application' }));
    await user.click(await screen.findByRole('radio', { name: /ID card reprint/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const staff = await screen.findByRole('combobox', { name: 'Staff member' });
    await waitFor(() => expect(staff).toHaveProperty('value', 'Abdul Karim'));
  });

  it('marks a paper application as filed on paper', async () => {
    mockList([row({ source: 'PAPER', applicant_role: null })]);
    mountStudent();

    expect(await screen.findByText('Filed on paper')).toBeTruthy();
  });

  it('links the view action to the application and the new button to the paper form', async () => {
    mockList([row()]);
    mountStudent();

    const view = await screen.findByRole('link', { name: 'View — Student leave 2026/0045' });
    expect(view.getAttribute('href')).toBe(`/applications/${APP_ID}`);
    const add = screen.getByRole('link', { name: 'Enter a paper application' });
    expect(add.getAttribute('href')).toBe(`/applications/new?student=${STUDENT_ID}`);
  });

  it('shows the empty state when nothing was filed', async () => {
    mockList([]);
    mountStudent();

    expect(await screen.findByText('No applications yet')).toBeTruthy();
  });

  it('offers the full list when more than the page limit exist', async () => {
    mockList([row()], undefined, 130);
    mountStudent();

    const link = await screen.findByRole('link', { name: 'See all' });
    expect(link.getAttribute('href')).toContain('/applications?');
    expect(link.getAttribute('href')).toContain('view=all');
  });

  it('a 403 shows the forbidden message', async () => {
    mockList('forbidden');
    mountStudent();

    expect(await screen.findByText("You don't have permission to view this.")).toBeTruthy();
  });
});
