import type { EntityManager } from 'typeorm';
import { todayInSchoolTz } from '../../common/time';
import { nextTenantSerial } from '../../common/utils/next-serial.util';

async function nextNumber(
  manager: EntityManager,
  tenantId: string,
  prefix: string,
  padLength: number,
): Promise<string> {
  // The school's (Asia/Dhaka) calendar year, never the server clock's: the process TZ is UTC in prod.
  const stem = `${prefix}-${todayInSchoolTz().slice(0, 4)}-`;
  const n = await nextTenantSerial(manager, {
    table: 'invoices',
    column: 'invoice_number',
    tenantId,
    prefix: stem,
  });
  // padStart is display only: past 99999 the number just grows wider.
  return `${stem}${String(n).padStart(padLength, '0')}`;
}

/** `INV-YYYY-NNNNN`, a per-school, per-year series. */
export function generateInvoiceNumber(manager: EntityManager, tenantId: string): Promise<string> {
  return nextNumber(manager, tenantId, 'INV', 5);
}

/** [16.5.1] `CN-YYYY-NNNNNN` — a credit note's own series, one digit wider than invoices'. */
export function generateCreditNoteNumber(
  manager: EntityManager,
  tenantId: string,
): Promise<string> {
  return nextNumber(manager, tenantId, 'CN', 6);
}
