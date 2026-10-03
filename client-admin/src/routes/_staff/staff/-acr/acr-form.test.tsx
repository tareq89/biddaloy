import {
  acrAssessmentFactory,
  acrCriterionFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcrForm } from './acr-form';

// The form has no router in tests; the print button only needs navigate + pathname.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => '/staff/u-1/acr',
}));

afterEach(async () => {
  await cleanupTestState();
});

const criteria = [
  acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', label_en: 'Punctuality', sort_order: 1 }),
  acrCriterionFactory({ id: 'c2', code: 'TEAMWORK', label_en: 'Teamwork', sort_order: 2 }),
];

async function renderForm(assessment = acrAssessmentFactory({ id: 'acr-1' })) {
  const onServerUpdate = vi.fn();
  renderWithProviders(
    <AcrForm assessment={assessment} criteria={criteria} onServerUpdate={onServerUpdate} />,
    { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
  );
  // The `evaluations` namespace suspends on first render.
  await screen.findByRole('heading', { name: 'Annual Confidential Report' });
  return onServerUpdate;
}

// The phone-only criterion "Next" also exists once the criteria step is
// mounted; the wizard's own Next is always last in the DOM.
function shellNext() {
  return screen.getAllByRole('button', { name: 'Next' }).at(-1) as HTMLElement;
}

function pressed(name: string) {
  return screen
    .getAllByRole('button', { name: new RegExp(`^${name}`) })[0]
    ?.getAttribute('aria-pressed');
}

describe('AcrForm', () => {
  it('digit keys score the active criterion and advance to the next', async () => {
    let patchBody: unknown;
    server.use(
      http.patch('/api/v1/acr/assessments/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' }));
      }),
    );
    await renderForm();

    fireEvent.click(shellNext());
    const teamwork = () => screen.getByText('Teamwork').closest('li');
    expect(teamwork()?.getAttribute('aria-current')).toBeNull();

    fireEvent.keyDown(document.body, { key: '4' });
    const first = screen.getByText('Punctuality').closest('li') as HTMLElement;
    expect(within(first).getByRole('button', { name: /^4/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(teamwork()?.getAttribute('aria-current')).toBe('true');

    fireEvent.keyDown(document.body, { key: '2' });
    expect(
      within(teamwork() as HTMLElement)
        .getByRole('button', { name: /^2/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    await waitFor(() =>
      expect(patchBody).toEqual({
        scores: [
          { criterion_id: 'c1', score: 4 },
          { criterion_id: 'c2', score: 2 },
        ],
      }),
    );
  });

  it('blocks submit until every criterion is scored, then completes on Ctrl+Enter', async () => {
    const completed = acrAssessmentFactory({
      id: 'acr-1',
      status: 'COMPLETED',
      total: 6,
      completed_at: '2026-09-30T00:00:00.000Z',
    });
    const complete = vi.fn(() => HttpResponse.json(completed));
    server.use(
      http.patch('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' })),
      ),
      http.post('/api/v1/acr/assessments/:id/complete', complete),
    );
    const onServerUpdate = await renderForm();

    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    expect(shellNext().hasAttribute('disabled')).toBe(false);

    fireEvent.click(shellNext());
    expect(shellNext().hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document.body, { key: '4' });
    fireEvent.keyDown(document.body, { key: '3' });
    expect(shellNext().hasAttribute('disabled')).toBe(false);

    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onServerUpdate).toHaveBeenCalledWith(completed));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('shows the Print button on a completed ACR (ADMIN) and not on an incomplete one', async () => {
    await renderForm(acrAssessmentFactory({ id: 'acr-1', status: 'COMPLETED', total: 7 }));
    expect(await screen.findByRole('button', { name: 'Print ACR' })).toBeTruthy();
    await cleanupTestState();
    await renderForm();
    expect(screen.queryByRole('button', { name: 'Print ACR' })).toBeNull();
  });

  it('renders a completed ACR read-only with a Reopen button', async () => {
    const assessment = acrAssessmentFactory({
      id: 'acr-1',
      status: 'COMPLETED',
      total: 7,
      step1_data: { description: 'Teaches maths' },
      scores: [
        { criterion_id: 'c1', score: 4 },
        { criterion_id: 'c2', score: 3 },
      ],
    });
    const reopened = acrAssessmentFactory({ id: 'acr-1', status: 'INCOMPLETE' });
    server.use(http.post('/api/v1/acr/assessments/:id/reopen', () => HttpResponse.json(reopened)));
    const onServerUpdate = await renderForm(assessment);

    const description = screen.getByLabelText('Description of duties');
    expect((description as HTMLTextAreaElement).value).toBe('Teaches maths');
    expect(description.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByRole('button', { name: /^4/ })[0]?.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Complete ACR' })).toBeNull();

    fireEvent.keyDown(document.body, { key: '1' });
    expect(pressed('4')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(onServerUpdate).toHaveBeenCalledWith(reopened));
  });
});
