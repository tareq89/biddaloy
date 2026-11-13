import type { LabelKey } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';

import { adminApiSession, createClassSection, post, type ApiSession } from '../api';
import { setLabels } from '../fixtures/modules';
import { expect, loggedIn, test } from '../fixtures/test';

/**
 * [Epic 77 / #3932] Where a renamed word reaches: screens, printed documents and SMS.
 *
 * THIS SPEC CHANGES SCHOOL SETTINGS. Words are school-wide, so every test puts each word it
 * touched back in `finally` (straight over the API, `null` per key). The tests run in order,
 * one at a time.
 *
 * Only pages whose i18n namespace is converted to `$t(common:entities.*)` follow the words
 * (students, classes). The sidebar, dashboard and teacher-assignments pages still show stock
 * words, so they are NOT asserted here (see 02-auth-and-multitenancy.md, Wave 5).
 */
test.describe.configure({ mode: 'serial' });

const WORDS = {
  section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' },
  student: { en: { one: 'Trainee', other: 'Trainees' }, bn: 'প্রশিক্ষণার্থী' },
  guardian: { en: { one: 'Parent', other: 'Parents' }, bn: 'পিতামাতা' },
};
const RESET = Object.fromEntries(Object.keys(WORDS).map((k) => [k, null])) as Record<
  LabelKey,
  null
>;
const SUFFIX = `${Date.now()}`;

/** An admit-card template made from a built-in suggestion; returns its draft as text. */
async function admitCard(
  request: APIRequestContext,
  session: ApiSession,
  key: 'admit-card-en' | 'admit-card-bn',
  tag: string,
): Promise<{ id: string; text: string }> {
  const created = await post<{ id: string; draft: unknown }>(request, session, '/print-templates', {
    name: `Words reach ${tag} ${SUFFIX}`,
    suggestion_key: key,
  });
  return { id: created.id, text: JSON.stringify(created.draft) };
}

test.describe('bn (the default locale)', () => {
  test.use(loggedIn('admin'));

  test('screens use the school words; reset brings the stock words back', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    try {
      await setLabels(request, session, WORDS);
      await page.goto('/students');
      await expect(page.getByRole('heading', { level: 1, name: 'প্রশিক্ষণার্থী' })).toBeVisible();
      await page.goto('/classes');
      await expect(page.getByRole('columnheader', { name: 'ব্যাচ' })).toBeVisible();

      // A school without custom words sees the stock words.
      await setLabels(request, session, RESET);
      await page.goto('/students');
      await expect(page.getByRole('heading', { level: 1, name: 'শিক্ষার্থী' })).toBeVisible();
      await page.goto('/classes');
      await expect(page.getByRole('columnheader', { name: 'শাখা' })).toBeVisible();
    } finally {
      await setLabels(request, session, RESET);
    }
  });
});

test.describe('en', () => {
  test.use(loggedIn('admin'));
  test.use({ e2eLocale: 'en' });

  test('plural forms on lists, stock words after reset', async ({ page, request }) => {
    const session = await adminApiSession(request);
    try {
      await setLabels(request, session, WORDS);
      await page.goto('/students');
      await expect(page.getByRole('heading', { level: 1, name: 'Trainees' })).toBeVisible();
      await page.goto('/classes');
      await expect(page.getByRole('columnheader', { name: 'Batches' })).toBeVisible();

      await setLabels(request, session, RESET);
      await page.goto('/students');
      await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
      await page.goto('/classes');
      await expect(page.getByRole('columnheader', { name: 'Sections' })).toBeVisible();
    } finally {
      await setLabels(request, session, RESET);
    }
  });
});

test.describe('print and SMS', () => {
  test.use(loggedIn('admin'));

  test('a template made after the rename carries the word; one made before keeps stock', async ({
    request,
  }) => {
    const session = await adminApiSession(request);
    const ids: string[] = [];
    try {
      const before = await admitCard(request, session, 'admit-card-en', 'before');
      ids.push(before.id);
      await setLabels(request, session, WORDS);
      const afterEn = await admitCard(request, session, 'admit-card-en', 'after-en');
      const afterBn = await admitCard(request, session, 'admit-card-bn', 'after-bn');
      ids.push(afterEn.id, afterBn.id);

      expect(afterEn.text).toContain('"Batch:"');
      expect(afterEn.text).not.toContain('"Section:"');
      expect(afterBn.text).toContain('"ব্যাচ:"');
      expect(afterBn.text).not.toContain('"শাখা:"');
      // Known limit: a template is a copy, so an existing one does not follow later renames.
      expect(before.text).toContain('"Section:"');
      expect(before.text).not.toContain('Batch');

      // No custom words: a new template is stock again.
      await setLabels(request, session, RESET);
      const reset = await admitCard(request, session, 'admit-card-en', 'reset');
      ids.push(reset.id);
      expect(reset.text).toContain('"Section:"');
    } finally {
      await setLabels(request, session, RESET);
      for (const id of ids) await post(request, session, `/print-templates/${id}/archive`, {});
    }
  });

  test('the absence notice text uses the school guardian word', async ({ request }) => {
    const session = await adminApiSession(request);
    const { sectionId } = await createClassSection(request, session);
    const preview = async () =>
      (
        await post<{ message_preview: string }>(
          request,
          session,
          `/attendance/sections/${sectionId}/absence-notice/preview`,
          { date: new Date().toISOString().slice(0, 10) },
        )
      ).message_preview;
    try {
      await setLabels(request, session, WORDS);
      // The notice goes out in the school's language; either text swaps the word.
      expect(await preview()).toMatch(/^(Dear Parent,|প্রিয় পিতামাতা,)/);

      await setLabels(request, session, RESET);
      expect(await preview()).toMatch(/^(Dear Guardian,|প্রিয় অভিভাবক,)/);
    } finally {
      await setLabels(request, session, RESET);
    }
  });
});
