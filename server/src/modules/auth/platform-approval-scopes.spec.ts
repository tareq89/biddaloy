import { describe, it, expect } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import { PLATFORM_APPROVAL_SCOPES } from './step-up.service';

describe('PLATFORM_APPROVAL_SCOPES', () => {
  // The cockpit step-up refuses any scope not on this list, so a platform scope missing here
  // makes every route behind it impossible to approve. New `platform.*` scopes must be added.
  it('lists every platform.* approval scope', () => {
    const platformScopes = Object.values(ApprovalScope).filter((s) => s.startsWith('platform.'));
    expect([...PLATFORM_APPROVAL_SCOPES].sort()).toEqual(platformScopes.sort());
  });
});
