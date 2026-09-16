import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';

// Arbitrary namespace for pg_advisory_xact_lock's two-key form, paired with
// the target year — keeps this lock's keyspace from colliding with any
// other advisory lock use in the app.
export const INVOICE_NUMBER_LOCK_NAMESPACE = 851209;

/** [16.5.1] Separate advisory-lock namespace for credit notes — a
 * different series (`CN-YYYY-NNNNNN`) doesn't need to serialize against
 * ordinary invoice numbering, only against itself. */
export const CREDIT_NOTE_NUMBER_LOCK_NAMESPACE = 851210;

async function nextSequentialNumber(
  invoiceRepo: Repository<Invoice>,
  lockNamespace: number,
  prefix: string,
  padLength: number,
): Promise<string> {
  const currentYear = new Date().getFullYear();

  // `SELECT ... FOR UPDATE` only locks rows that already exist, so two
  // transactions generating the very first document of a year would both
  // see no rows to lock and race to nextSeq=1. An advisory lock keyed on
  // the year serializes generation regardless of whether any row exists
  // yet; it's transaction-scoped, so it releases automatically on
  // commit/rollback.
  await invoiceRepo.manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
    lockNamespace,
    currentYear,
  ]);

  const last = await invoiceRepo
    .createQueryBuilder('inv')
    .withDeleted()
    .where('inv.invoice_number LIKE :pattern', { pattern: `${prefix}-${currentYear}-%` })
    .orderBy('inv.invoice_number', 'DESC')
    .getOne();

  let nextSeq = 1;
  if (last) {
    const parts = last.invoice_number.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }
  return `${prefix}-${currentYear}-${String(nextSeq).padStart(padLength, '0')}`;
}

export async function generateInvoiceNumber(invoiceRepo: Repository<Invoice>): Promise<string> {
  return nextSequentialNumber(invoiceRepo, INVOICE_NUMBER_LOCK_NAMESPACE, 'INV', 5);
}

/** [16.5.1] `CN-YYYY-NNNNNN` — a credit note's own series, one digit wider
 * than invoices' (`NNNNNN` vs `NNNNN`) per the ticket's spec. */
export async function generateCreditNoteNumber(invoiceRepo: Repository<Invoice>): Promise<string> {
  return nextSequentialNumber(invoiceRepo, CREDIT_NOTE_NUMBER_LOCK_NAMESPACE, 'CN', 6);
}
