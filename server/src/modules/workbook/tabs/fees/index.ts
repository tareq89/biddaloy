import type { TabSpec } from '../../codec/tab-spec';

/**
 * Tabs owned by the fees lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 */
export const feesTabs: TabSpec<any, any>[] = [];
