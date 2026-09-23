import type { TabSpec } from '../../codec/tab-spec';
import { gradingScalesTab } from './grading-scales.tab';
import { gradingBandsTab } from './grading-bands.tab';

/**
 * Tabs owned by the grading lane. `grading_scales` before `grading_bands`
 * since every band refs its scale.
 */
export const gradingTabs: TabSpec<any, any>[] = [gradingScalesTab, gradingBandsTab];

export { gradingScalesTab, gradingBandsTab };
export type { GradingScaleRow } from './grading-scales.tab';
export type { GradingBandRow } from './grading-bands.tab';
