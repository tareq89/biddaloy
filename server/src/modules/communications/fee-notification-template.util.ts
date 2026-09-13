/**
 * bn/en message text for the "new fees added" family notification [16.3.4].
 *
 * Kept as pure functions, same reasoning as reminder-template.util.ts: the
 * exact wording (and its Bengali-numeral formatting) is worth testing
 * directly rather than only through an integration test that sends a job.
 */

export type FeeNotificationLocale = 'bn' | 'en';

/** One bill this student was just charged, as the message lists it —
 * "মাসিক ফি ৪,২০০" / "Monthly Fee 4,200". `name` is the fee structure's own
 * name, copied verbatim: it is whatever the school typed in, in whichever
 * language they typed it, so this util never translates it. */
export interface FeeNotificationBillLine {
  name: string;
  amount: number;
}

const LATIN_TO_BENGALI_DIGITS: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => LATIN_TO_BENGALI_DIGITS[digit]);
}

/** Grouped thousands, no decimals for a whole amount ("4,200"), two decimals
 * only when the amount actually has a fractional part ("4,200.50") — a fee
 * notification is a headline number, not a receipt line. */
export function formatFeeNotificationAmount(locale: FeeNotificationLocale, amount: number): string {
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return locale === 'bn' ? toBengaliDigits(formatted) : formatted;
}

const EN_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const BN_MONTH_NAMES = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

/** "10 September" / "১০ সেপ্টেম্বর" — day + month name, no year, matching the
 * ticket's example wording. `dueDate` accepts a `Date` or an ISO date
 * string (TypeORM hands back `date`-typed columns as strings). */
export function formatFeeNotificationDueDate(
  locale: FeeNotificationLocale,
  dueDate: Date | string,
): string {
  const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const day = date.getUTCDate();
  const monthIndex = date.getUTCMonth();
  if (locale === 'bn') {
    return `${toBengaliDigits(String(day))} ${BN_MONTH_NAMES[monthIndex]}`;
  }
  return `${day} ${EN_MONTH_NAMES[monthIndex]}`;
}

function joinBillLines(locale: FeeNotificationLocale, bills: FeeNotificationBillLine[]): string {
  return bills
    .map((bill) => `${bill.name} ${formatFeeNotificationAmount(locale, bill.amount)}`)
    .join(', ');
}

/**
 * The full message body for one student's guardian: every bill this
 * generation batch created for that student, plus the batch's due date.
 *
 * bn: "নতুন ফি যোগ হয়েছে: মাসিক ফি ৪,২০০, পরীক্ষা ফি ৮০০ — শেষ তারিখ ১০ সেপ্টেম্বর"
 * en: "New fees added: Monthly Fee 4,200, Exam Fee 800 — Due date 10 September"
 */
export function buildFeeNotificationMessage(
  locale: FeeNotificationLocale,
  bills: FeeNotificationBillLine[],
  dueDate: Date | string,
): string {
  const billsText = joinBillLines(locale, bills);
  const dueDateText = formatFeeNotificationDueDate(locale, dueDate);
  return locale === 'bn'
    ? `নতুন ফি যোগ হয়েছে: ${billsText} — শেষ তারিখ ${dueDateText}`
    : `New fees added: ${billsText} — Due date ${dueDateText}`;
}

/** `settings.region.locale` (e.g. `bn-BD`) -> this util's locale. Mirrors
 * `account-access-templates.ts#resolveTemplateLocale` exactly, duplicated
 * rather than imported since that file's `TemplateLocale` type is scoped to
 * its own module's template kinds. */
export function resolveFeeNotificationLocale(
  regionLocale: string | undefined | null,
): FeeNotificationLocale {
  return regionLocale?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}
