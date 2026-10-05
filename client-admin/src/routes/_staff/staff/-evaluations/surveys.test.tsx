import {
  cleanupTestState,
  hiddenPairResultFactory,
  renderWithRouter,
  paginate,
  server,
  subjectFactory,
  surveyDetailFactory,
  surveyFactory,
  surveyResultsFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByText('Term 2 survey')).toBeTruthy();
    // The title is plain text now; the row's Open action is the link.
    expect(screen.queryByRole('link', { name: 'Term 2 survey' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy();
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
      await screen.findByText(/Waiting for more responses/, undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Average/)).toBeNull());
  });

  it('closing an open survey asks first; only the confirm calls the API', async () => {
    let closed = 0;
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({ id: 's1', title: 'Term 2 survey', status: 'OPEN' }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(surveyResultsFactory({ surveyId: 's1', minResponses: 5, results: [] })),
      ),
      http.post('/api/v1/surveys/s1/close', () => {
        closed += 1;
        return HttpResponse.json(surveyDetailFactory({ id: 's1', status: 'CLOSED' }));
      }),
    );
    render('/staff/evaluations/surveys/s1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close survey' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(closed).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Close survey' }));
    await waitFor(() => expect(closed).toBe(1));
  });
});

describe('survey form dialog validation and rows', () => {
  async function open() {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 });
    return userEvent.setup();
  }

  it('adds and removes target and question rows', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Add another teacher' }));
    expect(screen.getAllByRole('button', { name: 'Remove teacher' }).length).toBeGreaterThan(1);
    await user.click(screen.getAllByRole('button', { name: 'Remove teacher' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Add a question' }));
    expect(screen.getByLabelText('Question 4')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /Remove question/ })[3]!);
    expect(screen.queryByLabelText('Question 4')).toBeNull();
  });

  it('flags empty question text, low minimum, and reversed dates', async () => {
    const user = await open();
    await user.clear(screen.getByLabelText('Question 1'));
    await user.clear(screen.getByDisplayValue('3'));
    await user.type(screen.getByLabelText(/Opens/), '2026-05-10');
    await user.type(screen.getByLabelText(/Closes/), '2026-05-01');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert.querySelectorAll('li').length).toBeGreaterThanOrEqual(4);
  });

  it('flags a survey with every question removed', async () => {
    const user = await open();
    for (const b of screen.getAllByRole('button', { name: /Remove question/ })) await user.click(b);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/question/i);
  });
});

describe('survey form dialog submit', () => {
  async function fill() {
    server.use(
      http.get('/api/v1/subjects', ({ request }) =>
        HttpResponse.json(paginate([subjectFactory()], request.url)),
      ),
    );
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Survey title'), 'Term 2');
    for (const label of ['Teacher 1', 'Subject 1']) {
      await user.click(screen.getByRole('combobox', { name: label }));
      await user.click((await screen.findAllByRole('option'))[0]!);
    }
    await user.type(screen.getByLabelText(/Opens/), '2026-05-01');
    await user.type(screen.getByLabelText(/Closes/), '2026-05-10');
    return user;
  }

  it('creates and publishes, then closes the dialog', async () => {
    let published = false;
    server.use(
      http.post('/api/v1/surveys/:id/publish', () => {
        published = true;
        return HttpResponse.json(surveyDetailFactory(), { status: 201 });
      }),
    );
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(published).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New teacher survey' })).toBeNull(),
    );
  });

  it('shows the server message when create fails, via Ctrl+Enter', async () => {
    server.use(
      http.post('/api/v1/surveys', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Teacher not assigned',
            timestamp: 't',
            path: '/',
            requestId: 'r',
          },
          { status: 400 },
        ),
      ),
    );
    const user = await fill();
    await user.click(screen.getByLabelText('Survey title'));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Teacher not assigned')).toBeTruthy();
  });

  it('retry after a failed publish PATCHes the draft with the edited title, then publishes', async () => {
    const patched: unknown[] = [];
    let creates = 0;
    let publishes = 0;
    server.use(
      http.post('/api/v1/surveys', () => {
        creates += 1;
        return HttpResponse.json(surveyDetailFactory({ id: 'draft-1' }), { status: 201 });
      }),
      http.patch('/api/v1/surveys/:id', async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(surveyDetailFactory({ id: 'draft-1' }));
      }),
      http.post('/api/v1/surveys/:id/publish', () => {
        publishes += 1;
        return publishes === 1
          ? HttpResponse.json(
              { statusCode: 400, message: 'nope', timestamp: 't', path: '/', requestId: 'r' },
              { status: 400 },
            )
          : HttpResponse.json(surveyDetailFactory(), { status: 201 });
      }),
    );
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('nope')).toBeTruthy();
    await user.type(screen.getByLabelText('Survey title'), ' edited');
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(publishes).toBe(2));
    expect(creates).toBe(1);
    expect(patched).toHaveLength(1);
    expect((patched[0] as { title: string }).title).toBe('Term 2 edited');
  });
});
