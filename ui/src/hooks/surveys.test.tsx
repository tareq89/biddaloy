/**
 * [28.4.1] `surveys.ts` — responding refreshes `mine`; sealed results pass through untouched.
 */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hiddenPairResultFactory,
  pendingSurveyFactory,
  surveyResultsFactory,
} from '../test/factories/surveys';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { useMySurveys, useRespondSurvey, useSurveyResults } from './surveys';

afterEach(async () => {
  await cleanupTestState();
});

describe('useRespondSurvey', () => {
  it('refetches `mine` after a respond, even when the server says 409', async () => {
    let mineCalls = 0;
    server.use(
      http.get('/api/v1/surveys/mine', () => {
        mineCalls += 1;
        return HttpResponse.json(mineCalls === 1 ? [pendingSurveyFactory()] : []);
      }),
      http.post('/api/v1/surveys/:id/respond', () =>
        HttpResponse.json({ message: 'already answered' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({ mine: useMySurveys(), respond: useRespondSurvey('s1') }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.mine.data).toHaveLength(1));

    result.current.respond.mutate({ teacherId: 't', subjectId: 's', answers: [] });

    await waitFor(() => expect(result.current.mine.data).toEqual([]));
    expect(mineCalls).toBe(2);
  });
});

describe('useSurveyResults', () => {
  it('passes the sealed `{count, hidden: true}` shape through unchanged', async () => {
    const sealed = surveyResultsFactory({
      surveyId: 's1',
      results: [hiddenPairResultFactory(2)],
    });
    server.use(http.get('/api/v1/surveys/:id/results', () => HttpResponse.json(sealed)));

    const { result } = renderHookWithProviders(() => useSurveyResults('s1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.data).toEqual(sealed));
  });
});
