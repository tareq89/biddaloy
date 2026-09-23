import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [20.4.1] Grading scale editor, KEYBOARD ONLY for navigation and band
 * editing — no `page.mouse` and no `.click(` call reaches the editor
 * itself. Confirming the band change is approval-gated
 * (`ApprovalScope.GRADING_SCALE_MANAGE`, `-recompute-preview-dialog.tsx`)
 * and goes through `ApprovalModalPage`, the same shared step-up helper
 * every other approval-gated journey in this suite uses — there is no
 * keyboard-only precedent for that modal anywhere in the codebase, so
 * this reuses it rather than inventing one.
 *
 * Route: a fresh, bandless scale created via the API (`POST
 * /grading/scales`) rather than through the "Add scale" dialog — the
 * dialog itself is plain form input with nothing keyboard-specific to
 * prove, and this spec's subject is the *editor*.
 */

test.use(loggedIn('admin'));

test('keyboard-only: start from BD NCTB, edit a boundary, watch coverage, save', async ({
  page,
  request,
}) => {
  // `ApprovalModalPage.complete` waits out `OtpService`'s 60s-per-
  // identifier cooldown when a resend is needed — see `reversal.spec.ts`'s
  // and `checkout.spec.ts`'s own identical comment. Overruns Playwright's
  // 30s default, same reason this step's own `toBeHidden` assertion (the
  // confirm mutation's real DB write + audit + revision bump, not mocked
  // here) needs more room than its 5s default expect timeout under a
  // loaded CI runner.
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  // A fresh academic year (`createClassSection` mints one alongside a
  // class/section this spec doesn't need) keeps the scale's natural key
  // — name + year + class — clear of any other spec's rows.
  const { academicYearId } = await createClassSection(request, session);
  const scaleName = `E2E BD NCTB ${Date.now()}`;
  const scale = await post<{ id: string }>(request, session, '/grading/scales', {
    name: scaleName,
    academic_year_id: academicYearId,
  });

  await page.goto(`/grading-scales/${scale.id}`);
  await expect(page.getByRole('heading', { name: scaleName })).toBeVisible();

  await test.step('start from BD NCTB, keyboard only', async () => {
    // 60, not 20: tab traversal starts at document body and must pass the
    // skip link, header actions, and every sidebar item (plus PR #887's
    // [30.3.3] breadcrumb trail) before reaching this page's own content —
    // matching the budget the save step below already uses.
    await tabUntilFocused(page, t('grading.detail.startFromNctb'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    // Seven BD NCTB bands land in the table; the coverage bar goes green
    // (a single "covered" segment, no gap/overlap testids) immediately,
    // before anything is saved.
    await expect(page.getByText(t('grading.coverageBar.complete'))).toBeVisible();
    await expect(page.getByTestId('coverage-gap')).toHaveCount(0);
    await expect(page.getByTestId('coverage-overlap')).toHaveCount(0);
  });

  await test.step('edit a boundary by keyboard, coverage bar reacts', async () => {
    // Opens a gap: A+'s floor moves from 80 to 85, leaving 80-84
    // uncovered until A's own ceiling is edited too — this spec is
    // checking the coverage bar reacts live, not building a valid scale.
    await tabUntilFocused(page, t('grading.bandEditor.columnFrom'), 30, { tag: 'INPUT' });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('85');
    await page.keyboard.press('Tab'); // commit the change, move to "To %"

    await expect(page.getByTestId('coverage-gap')).toHaveCount(1);
    await expect(page.getByText(t('grading.coverageBar.hasGaps'))).toBeVisible();
  });

  await test.step('close the gap back up so save can succeed', async () => {
    // One `Tab` moved focus off the "From %" cell just edited (onto
    // "To %" in the same row) — `Shift+Tab` returns to that exact same
    // cell rather than re-searching forward, which would just as easily
    // land on the next row's own "From %" field.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('80');
    await page.keyboard.press('Tab');

    await expect(page.getByText(t('grading.coverageBar.complete'))).toBeVisible();
  });

  await test.step('save, approve the step-up, confirm', async () => {
    // 60, not 40: focus sits on row 0's "To %" cell here, so this must
    // clear the rest of that row plus all 6 remaining BD NCTB rows (7
    // cells each: from/to/grade/gpa/fail/comment/delete) and "Add band"
    // before reaching Save — roughly 49 cells, not a handful.
    await tabUntilFocused(page, t('grading.detail.save'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    await expect(page.getByText(t('grading.recomputePreview.title'))).toBeVisible();
    await page.getByRole('button', { name: t('grading.recomputePreview.confirm') }).click();

    // First confirm attempt trips `APPROVAL_REQUIRED`, which opens the
    // shared step-up modal on its own (`useApprovedMutation`) — see this
    // file's own header comment on why this one step isn't keyboard-only.
    // `ApprovalModalPage.complete` only waits for its own Verify click, not
    // for the *retried* confirm-bands request that follows — waiting on
    // that response explicitly (instead of just polling for the dialog to
    // close) surfaces a real failure's actual status/body directly, rather
    // than a bare "still visible after 15s" with no indication of why.
    const [confirmResponse] = await Promise.all([
      page.waitForResponse(
        async (response) => {
          if (response.request().method() !== 'POST') return false;
          if (!/\/grading\/scales\/[^/]+\/bands\/confirm$/.test(response.url())) return false;
          return (await response.request().headerValue('X-Approval-Token')) !== null;
        },
        { timeout: 30_000 },
      ),
      new ApprovalModalPage(page).complete('admin@biddaloy.test'),
    ]);
    expect(confirmResponse.ok(), await confirmResponse.text()).toBe(true);

    await expect(page.getByText(t('grading.recomputePreview.title'))).toBeHidden();
  });

  await test.step('the scale appears on the list', async () => {
    await page.goto('/grading-scales');
    await expect(page.getByRole('link', { name: scaleName })).toBeVisible();
  });
});
