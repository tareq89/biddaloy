import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
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
 * What it does add is the one path no section had: the read-failure
 * branch, which only `hr-record-family-section.tsx` reaches today. Table-
 * driven rather than six near-identical files, for the same reason.
 *
 * Each case costs ~3s regardless of the status code used (measured: a 403
 * and a 500 both land at ~3.0s, matching this file's sibling error case in
 * `hr-record-family-section.test.tsx`), so the status stays 500 to match
 * that sibling rather than diverging for a speed-up that does not exist.
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
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
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
