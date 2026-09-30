import {
  cleanupTestState,
  hiddenPairResultFactory,
  renderWithRouter,
  server,
  surveyDetailFactory,
  surveyFactory,
  surveyResultsFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [28.4.2] Survey admin screens against the real route tree. */
function render(entry: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('survey form dialog', () => {
  it('prefills the template questions, anonymous and minimum 3', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    const dialog = await screen.findByRole('dialog', { name: 'New teacher survey' });
    expect(
      await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('Treats students with respect')).toBeTruthy();
    expect(screen.getByDisplayValue('Is ready to help when I am stuck')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(dialog.textContent).toContain('Anonymous — hidden from management');
  });

  it('never claims answers are untraceable, in either state', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    const dialog = await screen.findByRole('dialog', { name: 'New teacher survey' });
    expect(dialog.textContent?.toLowerCase()).not.toContain('untraceable');
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Anonymous/ }));
    expect(dialog.textContent).toContain("Management will see each person's name");
    expect(dialog.textContent?.toLowerCase()).not.toContain('untraceable');
  });

  it('blocks submit and names what is missing', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save as draft' }));
    const alert = await screen.findByText('Enter a title.');
    expect(alert).toBeTruthy();
    expect(screen.getByText('Add at least one teacher and subject.')).toBeTruthy();
  });
});

describe('survey list and results', () => {
  it('lists surveys from the server', async () => {
    server.use(
      http.get('/api/v1/surveys', () =>
        HttpResponse.json([surveyFactory({ id: 's1', title: 'Term 2 survey', status: 'OPEN' })]),
      ),
    );
    render('/staff/evaluations?tab=surveys');
    expect(await screen.findByRole('link', { name: 'Term 2 survey' })).toBeTruthy();
  });

  it('shows the waiting message for sealed results and never an average', async () => {
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({ id: 's1', title: 'Term 2 survey', status: 'CLOSED' }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(
          surveyResultsFactory({
            surveyId: 's1',
            minResponses: 5,
            results: [hiddenPairResultFactory(2)],
          }),
        ),
      ),
    );
    render('/staff/evaluations/surveys/s1');
    expect(
      await screen.findByText('Waiting for more responses (2 of 5)', undefined, { timeout: 4000 }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Average/)).toBeNull());
  });
});
