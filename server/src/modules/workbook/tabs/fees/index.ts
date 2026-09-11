import type { TabSpec } from '../../codec/tab-spec';
import { feeStructuresTab } from './fee-structures.tab';

/**
 * Tabs owned by the fees lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * Registered in dependency order per EXPECTED_TABS (registry.ts):
 * fee_structures -> student_fees -> invoices -> payments -> payment_allocations.
 */
export const feesTabs: TabSpec<any, any>[] = [feeStructuresTab];

export { feeStructuresTab };
export type { FeeStructureRow } from './fee-structures.tab';
