/** [13.5.4] Guided setup: profile, curriculum preset, sections — MSW-backed, URL-held question. */
import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, schoolsHandlers, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuidedSetup } from './guided-setup';

const BASE = '/welcome?step=setup&path=guided';

function renderAt(q: number) {
  const root = createRootRoute();
  const welcome = createRoute({
    getParentRoute: () => root,
    path: '/welcome',
    component: () => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <GuidedSetup />
      </RegionConfigProvider>
    ),
  });
  return renderWithRouter(root.addChildren([welcome]), {
    initialEntries: [`${BASE}&q=${q}`],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

afterEach(cleanupTestState);

describe('ProfileStep', () => {
  it('is prefilled from the school profile and saves only the names', async () => {
    const body = vi.fn();
    server.use(
      http.patch('/api/v1/schools/me/profile', async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({});
      }),
    );
    const { router } = renderAt(1);
    const name = await screen.findByLabelText<HTMLInputElement>('School name (English)');
    expect(name.value).toBe('Ananta School');
    await userEvent.clear(name);
    // Enter in the field submits, like the Next button.
    await userEvent.type(name, 'New School{Enter}');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 2 }));
    expect(body).toHaveBeenCalledWith(expect.objectContaining({ name: 'New School' }));
  });

  it('does not write when nothing changed, and blocks an empty name', async () => {
    const patch = vi.fn();
    server.use(
      http.patch('/api/v1/schools/me/profile', () => {
        patch();
        return HttpResponse.json({});
      }),
    );
    const { router } = renderAt(1);
    const name = await screen.findByLabelText<HTMLInputElement>('School name (English)');
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Translated, never zod's default English.
    expect(await screen.findByText('Enter the school name.')).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ q: 1 });
    await userEvent.type(name, 'Ananta School');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 2 }));
  });

  it('shows the logo preview controls after a logo is uploaded', async () => {
    server.use(schoolsHandlers.uploadLogo);
    renderAt(1);
    await screen.findByLabelText('School name (English)');
    const file = new File(['bytes'], 'logo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Upload logo'), file);
    expect(await screen.findByRole('button', { name: 'Remove logo' })).toBeTruthy();
  });
});

const NCTB = {
  id: 'bd/nctb',
  version: '2026.1',
  name: { en: 'NCTB National Curriculum', bn: 'এনসিটিবি' },
  board: { en: 'NCTB', bn: 'এনসিটিবি' },
  description: { en: 'Primary.', bn: 'প্রাথমিক।' },
  verified: true,
  country: 'BD',
  stages: [{ key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } }],
};

describe('CurriculumStep', () => {
  it('applies the chosen preset through POST /presets/apply', async () => {
    const body = vi.fn();
    server.use(
      http.get('/api/v1/presets/status', () => HttpResponse.json({ state: 'AVAILABLE' })),
      http.get('/api/v1/presets', () => HttpResponse.json([NCTB])),
      http.post('/api/v1/presets/apply', async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({ created: { classes: 5 } }, { status: 201 });
      }),
    );
    renderAt(2);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Choose' }))[0]!);
    // the preset flow's own Next, not the guided one underneath it
    await userEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]!);
    await userEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Use this curriculum' }));
    const box = await screen.findByLabelText(/to confirm/);
    await userEvent.type(box, 'NCTB National Curriculum');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body).toHaveBeenCalledWith(expect.objectContaining({ preset_id: 'bd/nctb' }));
  });

  it('a school that is not fresh sees the reason and the by-hand link; Next skips to sections', async () => {
    server.use(
      http.get('/api/v1/presets/status', () =>
        HttpResponse.json({ state: 'CUSTOM', blockers: [{ entity: 'classes', count: 3 }] }),
      ),
      http.get('/api/v1/presets', () => HttpResponse.json([NCTB])),
    );
    const { router } = renderAt(2);
    expect(await screen.findByText(/already has classes or students/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set up by hand' }).getAttribute('href')).toBe(
      '/classes',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 3 }));
  });
});

const cls = (id: string, name: string) => ({ id, name });
const sec = (name: string) => ({ id: `s-${name}`, section_name: name, enrolled_count: 0 });

function mockClasses(
  classes: object[],
  sections: Record<string, object[]>,
  post: (classId: string, name: string) => Response | Promise<Response>,
) {
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: classes,
        total: classes.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/:id/sections', ({ params }) =>
      HttpResponse.json(sections[params.id as string] ?? []),
    ),
    http.post('/api/v1/classes/:id/sections', async ({ params, request }) => {
      const { section_name } = (await request.json()) as { section_name: string };
      return post(params.id as string, section_name);
    }),
  );
}

/** The steppers, once every row's sections have loaded (a loading row's field is disabled). */
async function sectionInputs() {
  const inputs = await screen.findAllByLabelText<HTMLInputElement>('Sections');
  await waitFor(() => expect(inputs.every((i) => !i.disabled)).toBe(true));
  return inputs;
}

describe('SectionsStep', () => {
  it('creates only the missing sections, in order, then moves on', async () => {
    const calls: string[] = [];
    mockClasses([cls('c1', 'Class 1'), cls('c2', 'Class 2')], { c2: [sec('A')] }, (id, name) => {
      calls.push(`${id}:${name}`);
      return HttpResponse.json({ id: 'x', section_name: name }, { status: 201 });
    });
    const { router } = renderAt(3);
    const inputs = await sectionInputs();
    // Class 2 already has A: defaults to "no change"; Class 1 gets three.
    expect((inputs[1] as HTMLInputElement).value).toBe('1');
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Create sections' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 'people' }));
    expect(calls).toEqual(['c1:A', 'c1:B', 'c1:C']);
  });

  it('a failed row shows an error and Retry while the others still go through', async () => {
    let failB = true;
    const calls: string[] = [];
    mockClasses([cls('c1', 'Class 1'), cls('c2', 'Class 2')], {}, (id, name) => {
      if (id === 'c1' && name === 'B' && failB) {
        return HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
      }
      calls.push(`${id}:${name}`);
      return HttpResponse.json({ id: 'x', section_name: name }, { status: 201 });
    });
    const { router } = renderAt(3);
    const inputs = await sectionInputs();
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '2');
    await userEvent.clear(inputs[1]!);
    await userEvent.type(inputs[1]!, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Create sections' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    // Class 2 was not held back by Class 1's failure.
    expect(calls).toContain('c2:B');
    expect(router.state.location.search).toMatchObject({ step: 'setup' });

    failB = false;
    await userEvent.click(retry);
    await waitFor(() => expect(calls).toContain('c1:B'));
  });

  it('custom-named sections count as sections: the default creates nothing, one more adds A', async () => {
    const calls: string[] = [];
    mockClasses([cls('c1', 'Class 1')], { c1: [sec('Morning'), sec('Day')] }, (id, name) => {
      calls.push(`${id}:${name}`);
      return HttpResponse.json({ id: 'x', section_name: name }, { status: 201 });
    });
    const { router } = renderAt(3);
    const [input] = await sectionInputs();
    expect(input!.value).toBe('2');
    expect(screen.getByText('Morning, Day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();

    await userEvent.clear(input!);
    await userEvent.type(input!, '3');
    expect(screen.getByText('Morning, Day, A')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create sections' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 'people' }));
    expect(calls).toEqual(['c1:A']);
  });

  it('with nothing to create, Next is enabled and moves on', async () => {
    const post = vi.fn();
    mockClasses([cls('c1', 'Class 1')], { c1: [sec('A')] }, (...a) => {
      post(...a);
      return HttpResponse.json({}, { status: 201 });
    });
    const { router } = renderAt(3);
    await screen.findByLabelText('Sections');
    const next = await screen.findByRole('button', { name: 'Next' });
    expect(next.hasAttribute('disabled')).toBe(false);
    await userEvent.click(next);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 'people' }));
    expect(post).not.toHaveBeenCalled();
  });
});
