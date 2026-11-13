import { SetMetadata } from '@nestjs/common';
import { ModuleKey } from '@biddaloy/shared';

export const REQUIRES_MODULE_KEY = 'requiresModule';

/**
 * [Epic 77] Tags a controller (or one handler; handler wins) with the module it
 * belongs to. PermissionsGuard answers 403 with one fixed sentence when that
 * module is off for the tenant or the caller's role. Untagged routes are unchanged.
 */
export const RequiresModule = (key: ModuleKey) => SetMetadata(REQUIRES_MODULE_KEY, key);
