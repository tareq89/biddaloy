import { toast } from '@biddaloy/ui/components';
import { i18n } from '@biddaloy/ui/i18n';

/** [98.4.07] The server ended an owner's session (idle limit, lock): say why on the sign-in page. */
export function showCockpitExpiredNotice(): void {
  toast(i18n.t('idle.expired', { ns: 'ownerSecurity' }), { duration: 15_000 });
}
