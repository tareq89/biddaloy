import { PhotoConsent } from '@biddaloy/shared';

import { createStudent, get, patch, postMultipart } from './api';
import { newSchool, skipSetup } from './fixtures/new-school';
import { expect, test } from './fixtures/test';
import { t } from './i18n';
import { ListShellPage } from './pages';

/** A real 1x1 PNG: the server re-encodes the upload, so a stub header is not enough. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const photo = { name: 'photo.png', mimeType: 'image/png', buffer: PNG };

interface StudentRow {
  photo_key: string | null;
  photo_consent: string;
}

/**
 * [59.3.03, D25 D26] Photo consent end to end, on a school of the spec's own: refusing removes the
 * photo after a confirm, an upload then shows the fixed sentence, and the list filter finds
 * students whose consent nobody recorded.
 */
test.describe('photo consent', () => {
  test.setTimeout(120_000);

  test('refusing consent removes the photo, and a new upload is turned away', async ({
    browser,
    playwright,
  }) => {
    const school = await newSchool(browser, playwright);
    const { page, api, session } = school;
    try {
      await skipSetup(page);
      const student = await createStudent(api, session, 'Photo Refuse E2E');
      await postMultipart(api, session, `/students/${student.id}/photo`, photo);
      expect((await get<StudentRow>(api, session, `/students/${student.id}`)).photo_key).not.toBe(
        null,
      );

      await test.step('set "দেননি": a confirm first, then the photo is gone', async () => {
        await page.goto(`/students/${student.id}/edit`);
        await page.getByRole('combobox', { name: t('students.photoConsent.label') }).click();
        await page
          .getByRole('option', { name: t('students.photoConsent.values.REFUSED'), exact: true })
          .click();
        const confirm = page.getByRole('alertdialog');
        await expect(confirm).toBeVisible();
        await confirm
          .getByRole('button', { name: t('students.photoConsent.confirm.confirm'), exact: true })
          .click();
        const saved = page.waitForResponse(
          (res) =>
            res.url().includes(`/students/${student.id}`) && res.request().method() === 'PATCH',
        );
        await page.getByRole('button', { name: t('students.edit.submitAction') }).click();
        expect((await saved).ok()).toBe(true);

        const after = await get<StudentRow>(api, session, `/students/${student.id}`);
        expect(after.photo_consent).toBe(PhotoConsent.REFUSED);
        expect(after.photo_key).toBeNull();
      });

      await test.step('an upload shows the fixed sentence', async () => {
        await page.goto(`/students/${student.id}?tab=documents`);
        await page.getByLabel(t('students.photo.upload')).setInputFiles(photo);
        await expect(
          page.getByRole('alert').filter({ hasText: t('students.photoConsent.uploadError') }),
        ).toBeVisible();
        expect((await get<StudentRow>(api, session, `/students/${student.id}`)).photo_key).toBeNull();
      });
    } finally {
      await school.context.close();
      await api.dispose();
    }
  });

  test('the list filter finds students whose consent is not recorded', async ({
    browser,
    playwright,
  }) => {
    const school = await newSchool(browser, playwright);
    const { page, api, session } = school;
    try {
      await skipSetup(page);
      await createStudent(api, session, 'Consent Unknown E2E');
      const given = await createStudent(api, session, 'Consent Given E2E');
      await patch(api, session, `/students/${given.id}`, { photo_consent: PhotoConsent.GIVEN });

      const list = new ListShellPage(page, { titleKey: 'students.list.title' });
      await page.goto('/students');
      await list.expectLoaded();
      await expect(list.row('Consent Given E2E')).toHaveCount(1);
      await list.filterBySelect(
        'students.photoConsent.filter',
        t('students.photoConsent.values.UNKNOWN'),
      );
      await expect(list.row('Consent Unknown E2E')).toHaveCount(1);
      await expect(list.row('Consent Given E2E')).toHaveCount(0);
    } finally {
      await school.context.close();
      await api.dispose();
    }
  });
});
