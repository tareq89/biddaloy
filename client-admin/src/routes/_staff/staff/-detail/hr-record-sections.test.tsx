import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordAchievementSection } from './hr-record-achievement-section';
import { HrRecordAddressSection } from './hr-record-address-section';
import { HrRecordEducationSection } from './hr-record-education-section';
import { HrRecordExperienceSection } from './hr-record-experience-section';
import { HrRecordLanguageSection } from './hr-record-language-section';
import { HrRecordTrainingSection } from './hr-record-training-section';

/**
 * The 6 [23.10] sections `hr-record-family-section.test.tsx` stands in
 * for: its save round-trip still covers the shared `RepeatableRowForm`
 * path once, so this deliberately does NOT repeat it six more times (D3).
 * What it does add is the `isError` branch of the other 6, which only
 * family's own test covers today. Table-driven rather than six
 * near-identical files, for the same reason.
 *
 * `apiErrorBody` + a 4xx is load-bearing for runtime, not decoration.
 * `staffRowsQueryOptions` sets `retry: shouldRetryQuery`, which overrides
 * `renderWithProviders`'s `retry: false`, so a retried failure costs
 * ~3s of TanStack backoff per case (~18s across these six). A *partial*
 * body like `{ message: 'boom' }` never becomes an `ApiError` —
 * `toApiError` requires `statusCode` + `message` + `requestId` — so it
 * surfaces as a plain axios error and misses `shouldRetryQuery`'s 4xx
 * short-circuit entirely, getting retried whatever status it carries.
 * A full body with a 4xx short-circuits properly: ~0.2s per case.
 * Same trap documented at `ui/src/hooks/classes.test.tsx:501-506`.
 */
const SECTIONS = [
  { name: 'HrRecordAddressSection', Section: HrRecordAddressSection, resource: 'address' },
  {
    name: 'HrRecordExperienceSection',
    Section: HrRecordExperienceSection,
    resource: 'experience',
  },
  { name: 'HrRecordEducationSection', Section: HrRecordEducationSection, resource: 'education' },
  { name: 'HrRecordTrainingSection', Section: HrRecordTrainingSection, resource: 'training' },
  {
    name: 'HrRecordAchievementSection',
    Section: HrRecordAchievementSection,
    resource: 'achievement',
  },
  { name: 'HrRecordLanguageSection', Section: HrRecordLanguageSection, resource: 'language' },
] as const;

afterEach(async () => {
  await cleanupTestState();
});

describe.each(SECTIONS)('$name', ({ Section, resource }) => {
  it(`shows an error state when GET /staff/:userId/${resource} fails`, async () => {
    server.use(
      http.get(`/api/v1/staff/user-1/${resource}`, () =>
        HttpResponse.json(apiErrorBody(403, 'boom', `/api/v1/staff/user-1/${resource}`), {
          status: 403,
        }),
      ),
    );

    renderWithProviders(<Section userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText('Could not load this section. Please try again.')).toBeTruthy();
  });
});
