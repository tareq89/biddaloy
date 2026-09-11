import type { TabSpec } from '../../codec/tab-spec';
import { usersTab } from './users.tab';

/**
 * Tabs owned by the people lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * `users` depends only on `school`, so it registers first.
 */
export const peopleTabs: TabSpec<any, any>[] = [usersTab];

export { usersTab };
export type { UserRow } from './users.tab';
