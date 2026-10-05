import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CurriculumPresetPage } from './CurriculumPresetPage';

const SCHOOL_ID = 'school-1';

const NCTB = {
  id: 'bd/nctb',
  version: '2026.1',
  name: { en: 'NCTB National Curriculum', bn: 'এনসিটিবি জাতীয় কারিকুলাম' },
  board: { en: 'NCTB', bn: 'এনসিটিবি' },
  description: { en: 'Primary to higher secondary.', bn: 'প্রাথমিক থেকে উচ্চ মাধ্যমিক।' },
  verified: true,
  country: 'BD',
  stages: [
    { key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } },
    { key: 'SECONDARY', name: { en: 'Secondary', bn: 'মাধ্যমিক' } },
  ],
  versions: [
    { key: 'Bangla', name: { en: 'Bangla', bn: 'বাংলা' } },
    { key: 'English', name: { en: 'English', bn: 'ইংরেজি' } },
  ],
};
const QAWMI = {
  ...NCTB,
  id: 'bd/qawmi',
  name: { en: 'Qawmi Madrasa', bn: 'কওমি মাদ্রাসা' },
  verified: false,
  versions: undefined,
};

const PREVIEW = {
  summary: NCTB,
  stages: NCTB.stages,
  versions: NCTB.versions,
  classes: [{ name: 'Class 1', numericGrade: 1, stage: 'PRIMARY' }],
  subjects: [
    { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
    { code: 'ISL', nameEn: 'Islam', nameBn: 'ইসলাম' },
    { code: 'HIN', nameEn: 'Hindu', nameBn: 'হিন্দু' },
    { code: 'BUD', nameEn: 'Buddhist', nameBn: 'বৌদ্ধ' },
    { code: 'CHR', nameEn: 'Christian', nameBn: 'খ্রিস্টান' },
  ],
  classSubjects: [
    { classGrade: 1, subjectCode: 'BAN' },
    ...['ISL', 'HIN', 'BUD', 'CHR'].map((subjectCode) => ({
      classGrade: 1,
      subjectCode,
      choiceGroup: 'Religion',
    })),
  ],
  groups: [],
  gradingScale: { name: 'GPA', bands: [{ from: 80, to: 100, grade: 'A+', gpa: 5, isFail: false }] },
  terms: [],
  examTemplates: [{ name: 'Half-yearly', rowCount: 3 }],
  certificates: ['TESTIMONIAL'],
  counts: { stages: 2, classes: 1, subjects: 5, classSubjects: 5, terms: 0, examTemplates: 1 },
};

function mockApi(status: Record<string, unknown>, presets: object[] = [NCTB, QAWMI]) {
  server.use(
    http.get('/api/v1/presets/status', () => HttpResponse.json(status)),
    http.get('/api/v1/presets', () => HttpResponse.json(presets)),
    http.get('/api/v1/presets/:id', () => HttpResponse.json(PREVIEW)),
  );
}

function renderPage() {
  const root = createRootRoute({ component: () => <CurriculumPresetPage schoolId={SCHOOL_ID} /> });
  const user = userEvent.setup();
  renderWithRouter(root, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });
  return user;
}

/** Walks to the confirm dialog for NCTB (versions required). */
async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole('button', { name: 'Choose' }))[0]!);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByLabelText('Bangla'));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Use this curriculum' }));
}

describe('CurriculumPresetPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a card per preset and flags unverified packs', async () => {
    mockApi({ state: 'AVAILABLE' });
    const root = createRootRoute({
      component: () => <CurriculumPresetPage schoolId={SCHOOL_ID} />,
    });
    const { baseElement } = renderWithRouter(root, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });
    expect(await screen.findByText('NCTB National Curriculum')).toBeDefined();
    expect(screen.getByText('Qawmi Madrasa')).toBeDefined();
    expect(screen.getAllByText('Not checked — review marks and grading before use')).toHaveLength(
      1,
    );
    await expect(baseElement).toHaveNoViolations();
  });

  it('opens the preview with Enter on a focused card and shows the choice group', async () => {
    mockApi({ state: 'AVAILABLE' });
    const user = renderPage();
    await screen.findByText('NCTB National Curriculum');
    await user.tab(); // first tab stop is the first card
    await user.keyboard('{Enter}');
    expect(await screen.findByText('One of: Islam / Hindu / Buddhist / Christian')).toBeDefined();
  });

  it('returns focus to the card that opened the preview when it is closed with Escape', async () => {
    mockApi({ state: 'AVAILABLE' });
    const user = renderPage();
    await screen.findByText('NCTB National Curriculum');
    await user.tab(); // first tab stop is the first card
    const card = document.activeElement;
    expect(card).not.toBe(document.body);
    await user.keyboard('{Enter}');
    await screen.findByText('One of: Islam / Hindu / Buddhist / Christian');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('One of: Islam / Hindu / Buddhist / Christian')).toBeNull(),
    );
    expect(document.activeElement).toBe(card);
  });

  it('encodes the slash in the preset id when previewing', async () => {
    const seen = vi.fn();
    mockApi({ state: 'AVAILABLE' });
    server.use(
      http.get('/api/v1/presets/:id', ({ request }) => {
        seen(new URL(request.url).pathname);
        return HttpResponse.json(PREVIEW);
      }),
    );
    const user = renderPage();
    await screen.findByText('NCTB National Curriculum');
    await user.click(screen.getByRole('button', { name: 'Preview: NCTB National Curriculum' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith('/api/v1/presets/bd%2Fnctb'));
  });

  it('needs at least one version for a pack with versions, and the exact name to apply', async () => {
    mockApi({ state: 'AVAILABLE' });
    const user = renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Choose' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // no version chosen yet
    expect(screen.getByText('Choose at least one version.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByLabelText('Primary')); // stage on -> off
    await user.click(screen.getByLabelText('Secondary'));
    expect(screen.getByText('Choose at least one stage.')).toBeDefined();
    await user.click(screen.getByLabelText('Primary'));
    await user.click(screen.getByLabelText('Bangla'));
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps Apply disabled until the exact English name is typed, then shows the summary', async () => {
    const body = vi.fn();
    mockApi({ state: 'AVAILABLE' });
    server.use(
      http.post('/api/v1/presets/apply', async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({ created: { classes: 12, subjects: 30 } }, { status: 201 });
      }),
    );
    const user = renderPage();
    await openConfirm(user);
    const box = await screen.findByLabelText(/Type .NCTB National Curriculum. to confirm/);
    expect(document.activeElement).toBe(box);
    const applyButton = screen.getByRole('button', { name: 'Apply' });
    await user.type(box, 'nctb national curriculum');
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    await user.clear(box);
    await user.type(box, 'NCTB National Curriculum');
    expect(applyButton.hasAttribute('disabled')).toBe(false);

    // after success the page re-reads status
    server.use(
      http.get('/api/v1/presets/status', () =>
        HttpResponse.json({
          state: 'APPLIED',
          preset: {
            id: 'bd/nctb',
            version: '2026.1',
            appliedAt: '2026-10-01T00:00:00Z',
            appliedByUserId: 'u1',
          },
        }),
      ),
    );
    await user.click(applyButton);
    expect(await screen.findByTestId('preset-applied')).toBeDefined();
    expect(screen.getByText('Classes')).toBeDefined();
    expect(body).toHaveBeenCalledWith({
      preset_id: 'bd/nctb',
      start_year: new Date().getFullYear(),
      stages: ['PRIMARY', 'SECONDARY'],
      versions: ['Bangla'],
    });
  });

  it('closes the dialog on a 409 and shows the blockers once status turns CUSTOM', async () => {
    mockApi({ state: 'AVAILABLE' });
    server.use(
      http.post('/api/v1/presets/apply', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'not fresh',
            timestamp: '',
            path: '',
            requestId: 'r',
            details: { code: 'PRESET_NOT_FRESH', blockers: [{ entity: 'classes', count: 3 }] },
          },
          { status: 409 },
        ),
      ),
    );
    const user = renderPage();
    await openConfirm(user);
    await user.type(await screen.findByLabelText(/Type .* to confirm/), 'NCTB National Curriculum');
    server.use(
      http.get('/api/v1/presets/status', () =>
        HttpResponse.json({ state: 'CUSTOM', blockers: [{ entity: 'classes', count: 3 }] }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('preset-blocked')).toBeDefined();
    expect(screen.getByText('classes — 3')).toBeDefined();
  });

  it('CUSTOM shows the message and blockers, never an apply button', async () => {
    mockApi({ state: 'CUSTOM', blockers: [{ entity: 'students', count: 40 }] });
    renderPage();
    expect(
      await screen.findByText('Your school was set up without a ready-made curriculum.'),
    ).toBeDefined();
    expect(screen.getByText('students — 40')).toBeDefined();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });

  it('shows an error panel with retry when status fails', async () => {
    server.use(
      http.get('/api/v1/presets/status', () =>
        HttpResponse.json({ message: 'x' }, { status: 400 }),
      ),
      http.get('/api/v1/presets', () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText('Could not load the ready-made curricula.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
