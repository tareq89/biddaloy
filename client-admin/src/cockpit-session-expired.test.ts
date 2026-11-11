import { toast } from '@biddaloy/ui/components';
import { describe, expect, it, vi } from 'vitest';

import { showCockpitExpiredNotice } from './cockpit-session-expired';

vi.mock('@biddaloy/ui/components', () => ({ toast: vi.fn() }));
vi.mock('@biddaloy/ui/i18n', () => ({
  i18n: { t: (k: string, o: { ns: string }) => `t:${o.ns}:${k}` },
}));

describe('showCockpitExpiredNotice', () => {
  it('toasts the ownerSecurity idle.expired text', () => {
    showCockpitExpiredNotice();
    expect(toast).toHaveBeenCalledWith('t:ownerSecurity:idle.expired', { duration: 15_000 });
  });
});
