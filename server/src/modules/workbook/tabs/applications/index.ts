import type { TabSpec } from '../../codec/tab-spec';
import {
  applicationAttachmentsTab,
  applicationEventsTab,
  applicationTagsTab,
} from './application-children.tab';
import { applicationsTab } from './applications.tab';

/** [52.1.6] Restore order: applications first, then the three tabs that hang off it. */
export const applicationsTabs: TabSpec<any, any>[] = [
  applicationsTab,
  applicationEventsTab,
  applicationTagsTab,
  applicationAttachmentsTab,
];

export { applicationsTab, applicationEventsTab, applicationTagsTab, applicationAttachmentsTab };
