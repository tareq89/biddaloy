import { AttendanceStatus } from '@biddaloy/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { makeT, type Locale } from '../i18n';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Drives the two staff attendance screens ([9.6]'s marking screen,
 * `/attendance/$sectionId`) and the portal's per-child calendar ([9.9]'s
 * `/portal/attendance`). Bespoke, not one of the `ListShell`/`DetailShell`
 * archetypes — the marking screen's roster and status-control popover
 * have no equivalent elsewhere in the app.
 */
export class AttendancePage {
  private readonly t: ReturnType<typeof makeT>;

  constructor(
    readonly page: Page,
    locale: Locale = 'bn',
  ) {
    this.t = makeT(locale);
  }

  async gotoSection(sectionId: string, date: string): Promise<void> {
    await this.page.goto(`/attendance/${sectionId}?date=${date}`);
    // Waits for the roster itself, not just any `<ul>` — the app shell's
    // own nav renders `<ul>`s too, and those exist well before the
    // register has finished loading.
    await expect(
      this.page.getByText(this.t('attendance.mark.rollNumber', { roll: 1 })).first(),
    ).toBeVisible();
  }

  /** The `<li>` row for one roll number — the roll span's text
   * (`t('mark.rollNumber', { roll })`) is unique per row in a section's
   * roster. */
  private rowFor(rollNumber: number): Locator {
    return this.page
      .locator('li')
      .filter({ hasText: this.t('attendance.mark.rollNumber', { roll: rollNumber }) });
  }

  private async fullNameFor(rollNumber: number): Promise<string> {
    const name = await this.rowFor(rollNumber).locator('span.font-medium').first().textContent();
    if (!name) throw new Error(`No row found for roll number ${rollNumber}`);
    return name.trim();
  }

  /** Sets one student's status via `AttendanceStatusControl`'s compact
   * trigger + popover — works uniformly for all four statuses, unlike the
   * row's own PRESENT<->ABSENT toggle button. The popover renders as a
   * `dialog` (`t('statusControl.popoverLabel', { name })`); its option
   * buttons carry no `aria-label` of their own, so they're matched on
   * their plain status text, scoped to that dialog so two students'
   * "Present" options can never collide. */
  async markStudent(rollNumber: number, status: AttendanceStatus): Promise<void> {
    const fullName = await this.fullNameFor(rollNumber);
    const row = this.rowFor(rollNumber);
    await row.getByRole('button', { name: new RegExp(`^${escapeRegExp(fullName)},`) }).click();
    const dialog = this.page.getByRole('dialog', {
      name: this.t('attendance.statusControl.popoverLabel', { name: fullName }),
    });
    await dialog
      .getByRole('button', {
        name: this.t(`attendance.statusControl.status.${status}`),
        exact: true,
      })
      .click();
  }

  async markAllPresent(): Promise<void> {
    await this.page.getByRole('button', { name: this.t('attendance.mark.allPresent') }).click();
  }

  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: this.t('attendance.mark.submitOnline') }).click();
  }

  /** Parses the header's "Present N - Absent N - Late N - Unmarked N"
   * summary line into numbers, by matching each translated label
   * (placeholder removed) against the digits that follow it. */
  async counters(): Promise<{ present: number; absent: number; late: number; unmarked: number }> {
    const summary = await this.page
      .locator('p')
      .filter({ hasText: this.t('attendance.mark.presentCount', { n: 0 }) })
      .first()
      .textContent();
    if (!summary) throw new Error('Attendance summary line not found');

    const extract = (key: string): number => {
      const label = this.t(key, { n: '' });
      const match = summary.match(new RegExp(`${escapeRegExp(label)}(\\d+)`));
      if (!match) throw new Error(`Could not find "${key}" in summary line: "${summary}"`);
      return Number(match[1]);
    };

    return {
      present: extract('attendance.mark.presentCount'),
      absent: extract('attendance.mark.absentCount'),
      late: extract('attendance.mark.lateCount'),
      unmarked: extract('attendance.mark.unmarkedCount'),
    };
  }

  async gotoPortalMonth(studentId: string, month: string): Promise<void> {
    await this.page.goto(`/portal/attendance?student=${studentId}&month=${month}`);
    await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible();
  }

  /** The month grid's day cell for one ISO date (`'2026-03-19'`) — matched
   * on the visible day-of-month number (plain ASCII digits, always —
   * `AttendanceMonthGrid` never runs it through `renderDigits`), not the
   * button's `aria-label`, which is a fully-formatted, numeral-localized
   * date and so can't be predicted from the ISO string alone. `(?!\d)`
   * stops "1" from matching "11"/"12"/etc. */
  dayCell(dateIso: string): Locator {
    const dayOfMonth = String(Number(dateIso.slice(-2)));
    return this.page.getByRole('button').filter({ hasText: new RegExp(`^${dayOfMonth}(?!\\d)`) });
  }
}
