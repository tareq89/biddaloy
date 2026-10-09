import type { TabSpec } from '../../codec/tab-spec';
import { printAssetsTab } from './print-assets.tab';
import { printerProfilesTab } from './printer-profiles.tab';
import { printTemplateVersionsTab } from './print-template-versions.tab';
import { printTemplatesTab } from './print-templates.tab';

/** In dependency order: assets before the templates that point at them, templates before their versions. */
export const printTabs: readonly TabSpec<any, any>[] = [
  printerProfilesTab,
  printAssetsTab,
  printTemplatesTab,
  printTemplateVersionsTab,
];
