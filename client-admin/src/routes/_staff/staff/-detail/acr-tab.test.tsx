import {
  acrAssessmentFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The tab renders a router <Link> and the start dialog calls useNavigate;
// neither needs a real router for what is asserted here.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#acr">{children}</a>,
  useNavigate: () => vi.fn(),
}));

import { AcrTab } from './acr-tab';
import { ReportIncidentDialog } from './report-incident-dialog';
import { StartAcrDialog } from './start-acr-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('AcrTab', () => {
  it('lists the history and offers Start ACR to ACR_WRITE', async () => {
    server.use(
      http.get('/api/v1/acr/staff/user-1', () =>
        HttpResponse.json([acrAssessmentFactory({ id: 'a1', user_id: 'user-1', total: 30 })]),
      ),
    );
    renderWithProviders(<AcrTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    expect(await screen.findByRole('button', { name: 'Start ACR' })).toBeTruthy();
    expect(await screen.findByText('30')).toBeTruthy();
  });

  it('hides Start ACR without ACR_WRITE', async () => {
    server.use(http.get('/api/v1/acr/staff/user-1', () => HttpResponse.json([])));
    renderWithProviders(<AcrTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'TEACHER',
    });
    expect(await screen.findByText('No ACR has been started for this staff member.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start ACR' })).toBeNull();
  });
});

describe('ReportIncidentDialog', () => {
  it('validates type, severity and text, then submits with the prefilled staff', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/incidents', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 'i1',
          createdAt: '2026-01-01T00:00:00Z',
          ...(body as object),
        });
      }),
    );
    renderWithProviders(
      <ReportIncidentDialog open onOpenChange={() => undefined} staffUserId="user-1" />,
      {
        locale: 'en',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Report' }));
    expect(await screen.findByText('Choose a type.')).toBeTruthy();
    expect(screen.getByText('Choose a severity.')).toBeTruthy();
    expect(screen.getByText('Describe what happened.')).toBeTruthy();
    expect(body).toBeUndefined();

    await user.click(screen.getByLabelText('Type'));
    await user.click(await screen.findByRole('option', { name: 'Complaint' }));
    await user.click(screen.getByLabelText('Severity'));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await user.type(screen.getByLabelText('What happened'), 'Late three days');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(body).toMatchObject({
        staffId: 'user-1',
        type: 'COMPLAINT',
        severity: 'HIGH',
        description: 'Late three days',
      }),
    );
  });

  it('rejects a future date', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/incidents', () => {
        posted = true;
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(
      <ReportIncidentDialog open onOpenChange={() => undefined} staffUserId="user-1" />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    const user = userEvent.setup();
    const date = await screen.findByLabelText('Date');
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByText('The date cannot be in the future.')).toBeTruthy();
    expect(posted).toBe(false);
  });
});

describe('StartAcrDialog', () => {
  it('announces a missing staff member instead of silently disabling submit', async () => {
    renderWithProviders(<StartAcrDialog open onOpenChange={() => undefined} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start ACR' }));
    expect(await screen.findByText('Choose a staff member.')).toBeTruthy();
  });

  it('shows a distinct message on 409', async () => {
    server.use(
      http.post('/api/v1/acr/assessments', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'dup', error: 'Conflict', requestId: 'r1' },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <StartAcrDialog open onOpenChange={() => undefined} staffUserId="user-1" />,
      {
        locale: 'en',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Academic year'));
    await user.click((await screen.findAllByRole('option'))[0]!);
    await user.click(screen.getByRole('button', { name: 'Start ACR' }));
    expect(
      await screen.findByText('An ACR already exists for this staff member and year.'),
    ).toBeTruthy();
  });
});
