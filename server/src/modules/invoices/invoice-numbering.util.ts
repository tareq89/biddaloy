import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';

// Arbitrary namespace for pg_advisory_xact_lock's two-key form, paired with
// the target year — keeps this lock's keyspace from colliding with any
// other advisory lock use in the app.
export const INVOICE_NUMBER_LOCK_NAMESPACE = 851209;

export async function generateInvoiceNumber(invoiceRepo: Repository<Invoice>): Promise<string> {
  const currentYear = new Date().getFullYear();

  // `SELECT ... FOR UPDATE` only locks rows that already exist, so two
  // transactions generating the very first invoice of a year would both
  // see no rows to lock and race to nextSeq=1. An advisory lock keyed on
  // the year serializes generation regardless of whether any row exists
  // yet; it's transaction-scoped, so it releases automatically on
  // commit/rollback.
  await invoiceRepo.manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
    INVOICE_NUMBER_LOCK_NAMESPACE,
    currentYear,
  ]);

  const last = await invoiceRepo
    .createQueryBuilder('inv')
    .withDeleted()
    .where('inv.invoice_number LIKE :pattern', { pattern: `INV-${currentYear}-%` })
    .orderBy('inv.invoice_number', 'DESC')
    .getOne();

  let nextSeq = 1;
  if (last) {
    const parts = last.invoice_number.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }
  return `INV-${currentYear}-${String(nextSeq).padStart(5, '0')}`;
}
