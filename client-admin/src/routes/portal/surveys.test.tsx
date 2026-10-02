import {
  apiErrorBody,
  cleanupTestState,
  pendingSurveyFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/** [28.4.3] Portal survey answer screen, against the real route tree. */
function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/portal/surveys'],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale: 'en',
  });
}

const survey = (anonymous: boolean) =>
  pendingSurveyFactory({
    id: 's1',
    anonymous,
    questions: [{ id: 'q1', text: 'Explains clearly', starsEnabled: true }],
    pending: [
      {
        teacherId: 't1',
        teacherName: 'Rahim Uddin',
        subjectId: 'sub1',
        subjectName: 'Mathematics',
        subjectNameBn: 'গণিত',
      },
    ],
  });

async function open() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByText('Rahim Uddin · Mathematics', undefined, { timeout: 4000 }),
  );
  return user;
}

afterEach(async () => {
  await cleanupTestState();
});

describe('/portal/surveys', () => {
  it.each([
    [true, 'Your answer is hidden from management.', 'Your name will be shown'],
    [false, 'Your name will be shown with your answer.', 'hidden from management'],
  ])('label matches the survey flag (anonymous=%s)', async (anonymous, shown, notShown) => {
    server.use(http.get('/api/v1/surveys/mine', () => HttpResponse.json([survey(anonymous)])));
    render();
    expect(await screen.findByText(shown, undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText(new RegExp(notShown))).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('untraceable');
  });

  it('stars are optional: a text-only answer is sent without stars', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get('/api/v1/surveys/mine', () => HttpResponse.json([survey(true)])),
      http.post('/api/v1/surveys/s1/respond', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ submitted: true }, { status: 201 });
      }),
    );
    render();
    const user = await open();
    await user.type(screen.getByLabelText('Explains clearly'), 'Very clear');
    await user.click(screen.getByRole('button', { name: 'Send answers' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      teacherId: 't1',
      subjectId: 'sub1',
      answers: [{ questionId: 'q1', text: 'Very clear' }],
    });
  });

  it('keys 1 to 5 set the rating', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get('/api/v1/surveys/mine', () => HttpResponse.json([survey(true)])),
      http.post('/api/v1/surveys/s1/respond', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ submitted: true }, { status: 201 });
      }),
    );
    render();
    const user = await open();
    screen.getByRole('button', { name: '2 of 5 stars' }).focus();
    await user.keyboard('4');
    await user.click(screen.getByRole('button', { name: 'Send answers' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ answers: [{ questionId: 'q1', stars: 4 }] });
  });

  it('refuses an empty submit', async () => {
    server.use(http.get('/api/v1/surveys/mine', () => HttpResponse.json([survey(true)])));
    render();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(await screen.findByText('Answer at least one question.')).toBeTruthy();
  });

  it('a duplicate submit (409) says it was already answered', async () => {
    server.use(
      http.get('/api/v1/surveys/mine', () => HttpResponse.json([survey(true)])),
      http.post('/api/v1/surveys/s1/respond', () =>
        HttpResponse.json(apiErrorBody(409, 'Already answered', '/surveys/s1/respond'), {
          status: 409,
        }),
      ),
    );
    render();
    const user = await open();
    await user.type(screen.getByLabelText('Explains clearly'), 'Again');
    await user.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(await screen.findByText('You already answered this one.')).toBeTruthy();
  });

  it('shows "Nothing waiting" when there is nothing to answer', async () => {
    server.use(http.get('/api/v1/surveys/mine', () => HttpResponse.json([])));
    render();
    expect(await screen.findByText('Nothing waiting', undefined, { timeout: 4000 })).toBeTruthy();
  });
});
