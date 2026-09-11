import { Module } from '@nestjs/common';
import { ALL_TABS, assertRegistryValid } from './codec/registry';

/**
 * School backup & migration (epic 14.0).
 *
 * Has no providers or controllers at 14.1.1: the codec under `codec/` is
 * plain functions with no Nest dependencies, and the service/controller that
 * will need DI arrive with later tickets. Registering the module now means
 * "the server still boots" is verified from the first ticket rather than the
 * last.
 *
 * It does carry one piece of behaviour: validating the tab registry at boot.
 * Four lanes each append to `ALL_TABS` through their own barrel file, so the
 * first moment their combined output exists is startup. Checking it here
 * turns a bad merge into a failed boot instead of a half-finished restore.
 */
@Module({})
export class WorkbookModule {
  constructor() {
    assertRegistryValid(ALL_TABS);
  }
}
