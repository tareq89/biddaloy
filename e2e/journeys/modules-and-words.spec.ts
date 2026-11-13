import { INSTITUTION_KINDS, UserRole } from '@biddaloy/shared';
import type { Browser, BrowserContext, Page, PlaywrightWorkerArgs } from '@playwright/test';

import { adminApiSession, loginAsFreshUser } from '../api';
import { shells } from '../config';
import { setLabels, setModules } from '../fixtures/modules';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';
import { ModulesWordsPage } from '../pages/modules-words-page';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';

/**
 * [Epic 77 / #3928] Settings › Modules & words, end to end: the four D36 usability tasks as
 * journeys, plus the failed-save revert.
 *
 * THIS SPEC CHANGES SCHOOL SETTINGS. Modules and words are school-wide, so every test puts
 * back each module and word it touched in `finally` (straight over the API: "apply" never turns
 * a module back on, and `null` is how a word returns to its stock value). The tests run in
 * order, one at a time.
 *
 * Propagation: a save refetches the school profile in the same tab, so the sidebar and the
 * words change at once. Only the teacher (a second browser) loads the page fresh.
 */
test.describe.configure({ mode: 'serial' });

const COACHING = INSTITUTION_KINDS.find((k) => k.id === 'coaching')!;
const SECTION_WORD = COACHING.labels.section!;
const CLASS_WORD = COACHING.labels.class!;
// Everything the coaching kind switches off, and the words it renames, for the reset.
const RESET_MODULES = Object.fromEntries(Object.keys(COACHING.modules).map((k) => [k, null]));
const RESET_LABELS = Object.fromEntries(Object.keys(COACHING.labels).map((k) => [k, null]));

const navLink = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: t('nav.navLabel') })
    .getByRole('link', { name, exact: true });

/** A second browser signed in as the seeded teacher, with every nav group open. */
async function teacherContext(
  browser: Browser,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<BrowserContext> {
  const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const state = await loginAsFreshUser(
      api,
      shells.app.baseURL,
      SEED_ROLE_EMAILS.teacher,
      process.env[SEED_PASSWORD_ENV] ?? '',
    );
    // Same groups the `loggedIn` fixture opens (e2e/fixtures/test.ts).
    const groups = [
      'people',
      'academics',
      'attendance',
      'examsResults',
      'finance',
      'reports',
      'communications',
      'administration',
    ];
    state.origins[0]?.localStorage.push(
      ...groups.map((id) => ({ name: `nav-group-collapsed-v2:${id}`, value: 'false' })),
    );
    return browser.newContext({ storageState: state });
  } finally {
    await api.dispose();
  }
}

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('task 1: pick Coaching, see the preview, Apply (2 clicks)', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const mw = new ModulesWordsPage(page);
    const shell = new AppShellPage(page);
    try {
      await mw.open();
      await shell.expectNavItem('nav.items.fines', true);

      // Click 1: the card. The preview opens; nothing has changed yet.
      await mw.kindCard(COACHING.name.bn).click();
      await expect(page).toHaveURL(/kind=coaching/);
      const off = mw.previewList('willBeOff');
      for (const key of ['fines', 'programs']) {
        await expect(off.getByText(t(`settings.modulesWords.moduleNames.${key}`))).toBeVisible();
      }
      await expect(page.getByRole('cell', { name: new RegExp(SECTION_WORD.bn!) })).toBeVisible();
      // (The preview is a full-page modal: the sidebar is behind it, so it is not asserted here.)

      // Click 2: Apply. The sidebar loses Fines; the class word becomes "Course".
      await mw.applyButton().click();
      await shell.expectNavItem('nav.items.fines', false);
      await expect(navLink(page, CLASS_WORD.bn!)).toBeVisible();

      // The Section word now reads "Batch" (Words tab shows what the screen says now).
      await mw.openWordsTab();
      await expect(mw.wordField('section', 'bn')).toHaveValue(SECTION_WORD.bn!);
      await expect(mw.wordField('section', 'one')).toHaveValue(SECTION_WORD.en!.one!);
    } finally {
      await setModules(request, session, RESET_MODULES);
      await setLabels(request, session, RESET_LABELS);
    }
  });

  test('task 2: the Fines switch saves at once, Undo brings it back (keyboard only)', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const mw = new ModulesWordsPage(page);
    const shell = new AppShellPage(page);
    try {
      await mw.open();
      await shell.expectNavItem('nav.items.fines', true);

      // D31: the switch is reachable and operable from the keyboard.
      const fines = mw.moduleSwitch('fines');
      await fines.focus();
      await page.keyboard.press('Space');
      await expect(mw.savedToast('fines', false)).toBeVisible();
      await expect(fines).not.toBeChecked();
      await shell.expectNavItem('nav.items.fines', false);

      await mw.undoButton().click();
      await expect(fines).toBeChecked();
      await shell.expectNavItem('nav.items.fines', true);
    } finally {
      await setModules(request, session, { fines: null });
    }
  });

  test('task 3: hide Homework from teachers; the teacher loses it, ADMIN keeps it', async ({
    page,
    request,
    browser,
    playwright,
  }) => {
    const session = await adminApiSession(request);
    const mw = new ModulesWordsPage(page);
    const shell = new AppShellPage(page);
    let teacher: BrowserContext | undefined;
    try {
      teacher = await teacherContext(browser, playwright);
      const teacherPage = await teacher.newPage();
      await teacherPage.goto('/students');
      await expect(navLink(teacherPage, t('nav.items.homework'))).toBeVisible();

      await mw.open();
      await mw.hideFromRoles('homework', [UserRole.TEACHER]);
      await expect(
        mw.moduleRow('homework').getByRole('button', {
          name: t('settings.modulesWords.modules.whoCantSeeSome', { count: 1 }),
        }),
      ).toBeVisible();

      await teacherPage.goto('/students');
      // The sidebar has loaded (Students is there) before "no Homework" counts.
      await expect(navLink(teacherPage, t('nav.items.students'))).toBeVisible();
      await expect(navLink(teacherPage, t('nav.items.homework'))).toHaveCount(0);
      // ADMIN is never hidden from.
      await shell.expectNavItem('nav.items.homework', true);
    } finally {
      await teacher?.close();
      await setModules(request, session, { homework: null });
    }
  });

  test('task 4: rename Section to Batch (en + bn); the screen follows at once', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const mw = new ModulesWordsPage(page);
    try {
      await mw.open('words');
      await mw.setWord('section', { one: 'Batch', other: 'Batches', bn: 'ব্যাচ' });
      // The class word is the one a sidebar title carries today (no screen prints the section
      // word yet, see the report): rename it in the same Save.
      await mw.setWord('class', { one: 'Course', other: 'Courses', bn: 'কোর্স' });
      await expect(
        page.getByText(t('settings.modulesWords.words.exampleValue', { word: 'Batches' })),
      ).toBeVisible();
      await mw.saveWordsButton().click();

      await expect(page.getByText(t('settings.modulesWords.words.saved'))).toBeVisible();
      // No reload: the profile refetch re-applied the words.
      await expect(navLink(page, 'কোর্স')).toBeVisible();
      await expect(mw.wordField('section', 'bn')).toHaveValue('ব্যাচ');
      await expect(mw.saveWordsButton()).toBeDisabled();

      await page.reload();
      await expect(mw.wordField('section', 'one')).toHaveValue('Batch');
    } finally {
      await setLabels(request, session, RESET_LABELS);
    }
  });
});

test.describe('failed save', () => {
  test.use(loggedIn('admin'));
  // page.route never sees /api when the built app's service worker answers it.
  test.use({ serviceWorkers: 'block' });

  test('a 500 on the switch puts it back and says "Not saved"', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const mw = new ModulesWordsPage(page);
    const shell = new AppShellPage(page);
    try {
      await mw.open();
      await page.route('**/api/v1/schools/*/settings', (route) =>
        route.request().method() === 'PATCH'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{"message":"boom"}',
            })
          : route.fallback(),
      );
      const fines = mw.moduleSwitch('fines');
      await expect(fines).toBeChecked();
      await fines.click();
      await expect(mw.moduleRow('fines').getByRole('alert')).toHaveText(
        t('settings.modulesWords.modules.notSaved'),
      );
      await expect(fines).toBeChecked();
      await shell.expectNavItem('nav.items.fines', true);
    } finally {
      await page.unroute('**/api/v1/schools/*/settings');
      await setModules(request, session, { fines: null });
    }
  });
});
