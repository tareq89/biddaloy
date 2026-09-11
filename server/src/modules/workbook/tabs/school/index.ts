import type { TabSpec } from '../../codec/tab-spec';
import { schoolTab } from './school.tab';

/**
 * Tabs owned by the school lane. Kept as a separate barrel so that no two
 * lanes ever edit `codec/registry.ts`.
 */
export const schoolTabs: TabSpec<any, any>[] = [schoolTab];

export { schoolTab };
export type { SchoolRow } from './school.tab';
