import { Invoice, InvoiceSnapshot } from './entities/invoice.entity';
import { InvoiceKind } from '@biddaloy/shared';

/** [16.5.2] Shared between `invoice-print.template.ts` (A4) and
 * `invoice-print-pos.template.ts` (58/80 mm thermal) so both formats
 * escape, format and filter identically — the whole point of "one
 * snapshot, three renderers" (D21) breaks if each format re-implements
 * this slightly differently. */

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function formatDate(value: Date | string): string {
  const d = new Date(value);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
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

/** Same digit-map convention as
 * `communications/fee-notification-template.util.ts`'s private
 * `toBengaliDigits` — duplicated rather than imported since that helper
 * isn't exported and lives in an unrelated module. Bengali numerals are
 * this app's default (bn-BD region default, see
 * `schools/settings/tenant-settings-defaults.ts`'s
 * `DEFAULT_REGION_SETTINGS.numerals`), so a printed amount renders in
 * Bengali digits by default; only invoice numbers/dates/ids stay Latin
 * since those are machine-referenced (support calls, reconciliation). */
function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => LATIN_TO_BENGALI_DIGITS[digit]);
}

/** Two-decimal amount, grouped, Bengali digits by default. `value` may
 * already be negative (a credit-note amount) — the sign renders as-is. */
export function formatAmount(value: number | string): string {
  const num = Number(value);
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return toBengaliDigits(formatted);
}

/** A credit note's `snapshot` is copied verbatim from the invoice it
 * reverses (see `InvoicesService.createCreditNote`) — its lines and
 * totals are still positive. The template negates them for display only,
 * so a printed credit note shows "-900.00" rather than a positive amount
 * next to a red "CREDIT NOTE" label that contradicts it. */
export function signedAmount(value: number, invoice: Invoice): number {
  return invoice.kind === InvoiceKind.CREDIT_NOTE ? -Math.abs(value) : value;
}

export function isCreditNote(invoice: Invoice): boolean {
  return invoice.kind === InvoiceKind.CREDIT_NOTE;
}

/** [664 follow-up, 665] Filters `snapshot.students[]` down to the ids a
 * family caller is actually linked to, mirroring the same filter
 * `invoices.controller.ts` already applies to the JSON response
 * (`findAll`/`findOne`, both `snapshot.students.filter((s) =>
 * linked.has(s.id))`). `linkedStudentIds === undefined` means "no
 * filtering" — the caller is staff/admin, who see every student on the
 * invoice, same as the JSON path. */
export function filterSnapshotForLinkedStudents(
  snapshot: InvoiceSnapshot,
  linkedStudentIds: string[] | undefined,
): InvoiceSnapshot {
  if (!linkedStudentIds) return snapshot;
  const linked = new Set(linkedStudentIds);
  const filteredStudents = snapshot.students.filter((s) => linked.has(s.id));
  const isPartialView = filteredStudents.length < snapshot.students.length;

  // Only recompute totals when a sibling was actually dropped — the common
  // case (guardian linked to every student on the invoice, or a
  // single-student invoice) must keep `snapshot.totals.paid` exactly as
  // `Invoice.create` recorded it (`payment.total_amount`, which can
  // legitimately differ from `sum(line.paid_this_time)` when the payment
  // overpays onto wallet credit) — otherwise the same invoice would print
  // two different "Paid" figures for staff vs. family callers.
  if (!isPartialView) return snapshot;

  // Recompute the aggregate money totals from only the linked students'
  // lines — otherwise an unlinked sibling's billed/discount/paid amounts
  // still leak into the printed totals even though their name/lines are
  // hidden. `change`/`wallet_*` are whole-payment concepts that don't
  // split per student, so they're zeroed out for a filtered (partial)
  // view rather than shown as if they belonged to the linked student(s).
  const linkedLines = filteredStudents.flatMap((s) => s.lines);
  const recomputedTotals = {
    billed: linkedLines.reduce((sum, l) => sum + l.amount, 0),
    discount: linkedLines.reduce((sum, l) => sum + l.discount, 0),
    paid: linkedLines.reduce((sum, l) => sum + l.paid_this_time, 0),
    change: isPartialView ? 0 : snapshot.totals.change,
    wallet_used: isPartialView ? 0 : snapshot.totals.wallet_used,
    wallet_added: isPartialView ? 0 : snapshot.totals.wallet_added,
  };

  return {
    ...snapshot,
    students: filteredStudents,
    totals: recomputedTotals,
  };
}
