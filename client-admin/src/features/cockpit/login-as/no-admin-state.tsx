import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/** D26: nobody to log in as, so the way forward is the invite-admin dialog. */
export function NoAdminState({ onInvite }: { onInvite: () => void }) {
  const { t } = useTranslation('loginAs');
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <p>{t('noAdmin.text')}</p>
      <Button type="button" onClick={onInvite} className="w-full sm:w-auto">
        {t('noAdmin.invite')}
      </Button>
    </div>
  );
}
