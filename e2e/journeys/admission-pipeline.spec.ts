import type { APIRequestContext, Page } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createWalkInApplicant,
  get,
  patch,
  post,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [Epic 71.0 #2204, ticket #4203] The admission desk end to end, as the school admin in the staff app:
 * new-round wizard -> clerk entry (walk-in with a fee proof) -> fee check -> roll numbers + marks ->
 * cut-off -> merit + waiting lists -> publication; a second round covers the lottery draw.
 *
 * UI-driven: wizard, clerk entry (one applicant), fee confirm / send back, roll numbers, marks grid,
 * cut-off preview + commit, merit and waiting list dialogs, publish, lottery draw.
 * API-driven (comments at each place): the other applicants (the clerk form is covered once), the stage's
 * full marks (the wizard never sets `total_marks`, so a wizard round is pass/fail until it is set;
 * no screen sets it), and the lottery round (its wizard path is the same as the first round's).
 */
test.use(loggedIn('admin'));

// A 1x1 PNG: the server checks the signature, not the mimetype the client sends.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const DAY_MS = 86_400_000;
const isoIn = (days: number): string => {
  const d = new Date(Date.now() + days * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A BD mobile number unique per call (the round refuses a second application on one number). */
let phoneSeq = 0;
const phone = () => `01711${String((Date.now() + phoneSeq++) % 1_000_000).padStart(6, '0')}`;

/**
 * Opens the kit DatePicker named `label` and picks `iso`, paging months until it is on screen.
 * Same retry-as-a-whole shape as `journeys/portal-applications.spec.ts`.
 */
async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  const grid = page.getByRole('grid');
  const cell = page.locator(`[role="grid"] [data-date="${iso}"]`);
  await expect(async () => {
    if (!(await grid.isVisible())) await page.getByRole('button', { name: label }).click();
    for (let i = 0; i < 24 && !(await cell.isVisible()); i += 1) {
      const shown = await grid.locator('[data-date]').nth(15).getAttribute('data-date');
      const key = (shown ?? iso) > iso ? 'common.date.previousMonth' : 'common.date.nextMonth';
      await page.getByRole('button', { name: t(key) }).click({ timeout: 3_000 });
    }
    await cell.click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(grid).toHaveCount(0);
}

/**
 * A walk-in on a FEE round, over the API: `createWalkInApplicant` has no fee fields. Same multipart
 * body the clerk screen sends (`fee_method` + a `fee_proof` file). Returns the applicant's reference.
 */
async function createFeeWalkIn(
  request: APIRequestContext,
  session: ApiSession,
  intakeId: string,
  name: string,
): Promise<string> {
  const response = await request.post('/api/v1/admission/applicants', {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
      'Idempotency-Key': crypto.randomUUID(),
    },
    multipart: {
      intake_id: intakeId,
      applicant_name: name,
      date_of_birth: '2018-06-01',
      gender: 'MALE',
      guardian_name: `Guardian of ${name}`,
      guardian_phone: phone(),
      extra_fields: JSON.stringify({ father_name: 'E2E Father', mother_name: 'E2E Mother' }),
      fee_method: 'BKASH',
      fee_proof: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  if (!response.ok()) {
    throw new Error(`fee walk-in failed: ${response.status()} ${await response.text()}`);
  }
  return ((await response.json()) as { reference_number: string }).reference_number;
}

interface StageRow {
  id: string;
  kind: string;
}
interface ListsBody {
  seats_left: number;
  lists: { id: string; kind: string; counts: Record<string, number> }[];
}

test('admission desk: round wizard -> clerk entry -> fees -> marks -> cut-off -> lists -> publish', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const admin = await adminApiSession(request);
  const stamp = Date.now();
  const names = {
    clerk: `Clerk ${stamp}`,
    sentBack: `Sentback ${stamp}`,
    second: `Second ${stamp}`,
    absent: `Absent ${stamp}`,
  };
  let roundId = '';
  let stageId = '';
  const section = await createClassSection(request, admin);

  await test.step('the wizard creates a written-exam round with a fee and 2 seats', async () => {
    await page.goto('/admissions/intakes/new');
    // Kind step: the class list follows the chosen year, and the wizard starts on the current
    // year, not the fresh one `createClassSection` made. Pick that year first (this clears the
    // class), then the fresh class by name.
    await page.getByRole('combobox', { name: t('admission-desk.wizard.year') }).click();
    await page
      .getByRole('option', { name: section.className.replace(/^E2E /, 'E2E Year '), exact: true })
      .click();
    await page.getByRole('combobox', { name: t('admission-desk.wizard.class') }).click();
    await page.getByRole('option', { name: section.className, exact: true }).click();
    const next = page.getByRole('button', { name: t('common.wizard.next') });
    await next.click();
    // Seats step. (The dates are pre-filled: today .. +30 days.)
    await page.locator('#wz-seats').fill('2');
    await next.click();
    // Fee step: a fee makes every application wait for a fee check.
    await page.locator('#wz-fee').fill('500');
    await next.click();
    // Publish step: the defaults stay (site + status check, no SMS).
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/admission-intakes') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: t('admission-desk.wizard.create') }).click();
    expect((await created).ok()).toBe(true);
    await page.waitForURL(/\/admissions\/rounds\/[0-9a-f-]{36}/);
    roundId = /\/admissions\/rounds\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    const stages = await get<StageRow[]>(request, admin, `/admission-intakes/${roundId}/stages`);
    stageId = stages.find((s) => s.kind === 'WRITTEN')!.id;
  });

  await test.step('clerk entry saves a walk-in with a fee proof', async () => {
    await page.goto(`/admissions/applicants/new?round=${roundId}`);
    // Ids are `clerk-<field key>`: the catalogue labels carry a ` *` and repeat words ("নাম").
    const box = (key: string) => page.locator(`#clerk-${key}`);
    await box('name').fill(names.clerk);
    await box('dob').fill('2018-06-01');
    await box('gender').click();
    await page.getByRole('option', { name: t('admission-desk.clerk.options.MALE') }).click();
    await box('guardian_name').fill(`Guardian of ${names.clerk}`);
    await box('guardian_phone').fill(phone());
    await box('father_name').fill('E2E Father');
    await box('mother_name').fill('E2E Mother');
    await box('fee-method').click();
    await page.getByRole('option', { name: t('admission-desk.wizard.method.BKASH') }).click();
    await box('fee-ref').fill(`TX${stamp}`);
    await page
      .locator('#clerk-file-_feeProof')
      .setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/admission/applicants') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: t('admission-desk.clerk.save') }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    const { reference_number: ref } = (await response.json()) as { reference_number: string };
    await expect(page.getByText(t('admission-desk.clerk.done', { ref }))).toBeVisible();
  });

  await test.step('three more walk-ins are seeded over the API (the clerk form is covered above)', async () => {
    await createFeeWalkIn(request, admin, roundId, names.sentBack);
    await createFeeWalkIn(request, admin, roundId, names.second);
    await createFeeWalkIn(request, admin, roundId, names.absent);
  });

  await test.step('the desk asks for the fee check; one proof is sent back, three are confirmed', async () => {
    await page.goto(`/admissions/rounds/${roundId}`);
    await page
      .getByRole('button', { name: t('admission-desk.applicantsPanel.checkFees', { num: 4 }) })
      .click();
    const queue = page.getByRole('region', {
      name: t('admission-desk.applicantsPanel.queueLabel'),
    });
    const dialog = page.getByRole('dialog');

    const decide = async (name: string, action: 'confirm' | 'sendBack') => {
      await queue
        .getByRole('listitem')
        .filter({ hasText: name })
        .getByRole('button', { name: t('admission-desk.applicantsPanel.check') })
        .click();
      await expect(
        dialog.getByRole('heading', { name: t('admission-desk.fee.title', { name }) }),
      ).toBeVisible();
      if (action === 'sendBack') {
        await dialog
          .getByLabel(t('admission-desk.fee.reasonLabel'))
          .fill('The payment number does not match.');
      }
      const decided = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().includes('/api/v1/admission/fee-proofs/') &&
          r.url().endsWith(action === 'confirm' ? '/confirm' : '/send-back'),
      );
      await dialog.getByRole('button', { name: t(`admission-desk.fee.${action}`) }).click();
      expect((await decided).ok()).toBe(true);
      await expect(dialog).toBeHidden();
    };

    await decide(names.clerk, 'confirm');
    await decide(names.sentBack, 'sendBack');
    await decide(names.second, 'confirm');
    await decide(names.absent, 'confirm');
    // Only the sent-back proof leaves the waiting queue, so the queue (and its chip) is gone.
    await expect(queue).toBeHidden();
  });

  await test.step('the stage takes marks out of 100 (set over the API: no screen sets the full marks)', async () => {
    // ponytail: the wizard creates the stage with only `list_order`, so it is PASS_FAIL and the
    // desk hides the cut-off. Surprising; see the report. Full marks make it a SCORE stage.
    await patch(request, admin, `/admission-intakes/${roundId}/stages/${stageId}`, {
      config: { list_order: 'MERIT', total_marks: 100 },
    });
  });

  await test.step('roll numbers go to the three applicants whose fee is confirmed', async () => {
    await page.goto(`/admissions/rounds/${roundId}?step=${stageId}`);
    const rolled = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/admission/intakes/${roundId}/rolls`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: t('admission-stages.header.makeRolls') }).click();
    const response = await rolled;
    expect(response.ok()).toBe(true);
    // The sent-back applicant is still waiting on the fee, so is not numbered.
    expect(((await response.json()) as { assigned: number }).assigned).toBe(3);
  });

  await test.step('marks are entered and saved', async () => {
    const cell = (name: string) => page.getByRole('textbox', { name: new RegExp(escapeRe(name)) });
    await cell(names.clerk).fill('90');
    await cell(names.second).fill('70');
    await page
      .getByRole('checkbox', {
        name: t('admission-stages.grid.absentLabel', { name: names.absent }),
      })
      .check();
    const put = page.waitForResponse(
      (r) => r.url().includes('/results') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: t('admission-stages.grid.save') }).click();
    expect((await put).ok()).toBe(true);
    await expect(page.getByText(t('admission-stages.grid.saved', { count: 3 }))).toBeVisible();
  });

  await test.step('the cut-off preview shows who goes on; confirming records it', async () => {
    const cutoff = page.getByRole('region', { name: t('admission-stages.cutoff.title') });
    await cutoff.getByLabel(t('admission-stages.cutoff.value')).fill('2');
    await cutoff.getByRole('button', { name: t('admission-stages.cutoff.show') }).click();
    await expect(
      cutoff.getByText(t('admission-stages.cutoff.summary', { pass: 2, fail: 1 })),
    ).toBeVisible();
    const commit = page.waitForResponse(
      (r) => r.url().endsWith('/cutoff/commit') && r.request().method() === 'POST',
    );
    await cutoff.getByRole('button', { name: t('admission-stages.cutoff.confirm') }).click();
    expect((await commit).ok()).toBe(true);
    await expect(page.getByText(t('admission-stages.header.cutoffDone'))).toBeVisible();
  });

  await test.step('the merit list offers 1 of the 2 seats', async () => {
    await page.goto(`/admissions/rounds/${roundId}?step=merit`);
    await page.getByRole('button', { name: t('admission-lists.panel.buildMerit') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('admission-lists.build.capacity')).fill('1');
    await pickDate(page, t('admission-lists.build.deadline'), isoIn(10));
    const built = page.waitForResponse(
      (r) => r.url().endsWith(`/intakes/${roundId}/lists/merit`) && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: t('admission-lists.build.save') }).click();
    expect((await built).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    // The card shows counts, not names: one person is offered the seat.
    await expect(page.getByText(t('admission-lists.card.offered', { count: 1 }))).toBeVisible();
  });

  await test.step('a waiting list takes the next person in merit order', async () => {
    await page.goto(`/admissions/rounds/${roundId}?step=waiting`);
    await page.getByRole('button', { name: t('admission-lists.panel.newWaiting') }).click();
    const dialog = page.getByRole('dialog');
    // Capacity is pre-filled with the one seat left.
    await pickDate(page, t('admission-lists.build.deadline'), isoIn(20));
    const built = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/intakes/${roundId}/lists/waiting`) && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: t('admission-lists.build.save') }).click();
    expect((await built).ok()).toBe(true);
    await expect(dialog).toBeHidden();

    const lists = await get<ListsBody>(request, admin, `/admission/intakes/${roundId}/lists`);
    expect(lists.lists.find((l) => l.kind === 'MERIT')?.counts.OFFERED).toBe(1);
    expect(lists.lists.find((l) => l.kind === 'WAITING')?.counts.WAITING).toBe(1);
  });

  await test.step('the merit list and the stage result are published (no SMS)', async () => {
    await page.goto(`/admissions/rounds/${roundId}?step=admit`);
    const row = (label: string) =>
      page.locator('section').filter({
        has: page.getByRole('heading', { level: 3, name: label, exact: true }),
      });
    const publish = async (label: string) => {
      const target = row(label);
      await target.getByRole('button', { name: t('admission-lists.publish.action') }).click();
      const sent = page.waitForResponse(
        (r) => r.url().endsWith(`/intakes/${roundId}/publish`) && r.request().method() === 'POST',
      );
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t('admission-lists.publish.action') })
        .click();
      expect((await sent).ok()).toBe(true);
      await expect(
        target.getByText(t('admission-lists.publish.published'), { exact: true }),
      ).toBeVisible();
    };
    await publish(t('admission-desk.desk.steps.kind.WRITTEN'));
    await publish(t('admission-lists.card.merit'));
    // The waiting list stays unpublished.
    await expect(
      row(t('admission-lists.card.waiting', { n: 1 })).getByText(
        t('admission-lists.publish.notPublished'),
        { exact: true },
      ),
    ).toBeVisible();
  });

  await test.step('a second round with a lottery stage draws once', async () => {
    // ponytail: the round is made over the API; its wizard path is the same as the first round's.
    const lotterySection = await createClassSection(request, admin);
    const round = await post<{ id: string }>(request, admin, '/admission-intakes', {
      title: `E2E Lottery ${stamp}`,
      class_id: lotterySection.classId,
      template_key: 'LOTTERY',
      seat_count: 2,
      open_date: isoIn(-2),
      close_date: isoIn(60),
      required_document_types: [],
    });
    const stages = await get<StageRow[]>(request, admin, `/admission-intakes/${round.id}/stages`);
    const lotteryId = stages.find((s) => s.kind === 'LOTTERY')!.id;
    const drawn = [`Lot A ${stamp}`, `Lot B ${stamp}`];
    for (const name of drawn) {
      await createWalkInApplicant(request, admin, {
        intakeId: round.id,
        name,
        guardianPhone: phone(),
      });
    }

    await page.goto(`/admissions/rounds/${round.id}?step=${lotteryId}`);
    // The desk's "what to do now" card has a button with the same name; use the panel's own card.
    const drawCard = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: t('admission-stages.lottery.drawCard') }) });
    await drawCard.getByRole('button', { name: t('admission-stages.lottery.drawButton') }).click();
    const draw = page.waitForResponse(
      (r) => r.url().endsWith('/lottery/draw') && r.request().method() === 'POST',
    );
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('admission-stages.lottery.drawConfirm') })
      .click();
    expect((await draw).ok()).toBe(true);
    await expect(page.getByText(t('admission-stages.lottery.done'))).toBeVisible();
    for (const name of drawn) await expect(page.getByRole('cell', { name })).toBeVisible();
    // Once drawn, neither a second draw nor an upload is offered.
    await expect(drawCard).toHaveCount(0);
  });
});
