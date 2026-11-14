import { UserRole } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** D12: ADMIN (and SUPER_ADMIN) are never listed, so they can never hide a module from themselves. */
export const HIDEABLE_ROLES = Object.values(UserRole).filter(
  (r) => r !== UserRole.ADMIN && r !== UserRole.SUPER_ADMIN,
);

interface RoleOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleName: string;
  /** Roles the module is hidden from now. */
  current: UserRole[];
  saving: boolean;
  failed: boolean;
  onSave: (roles: UserRole[]) => void;
}

/** D30: "Who can't see it" for one module. Its own Save, so a half-picked list never goes out. */
export function RoleOffDialog({
  open,
  onOpenChange,
  moduleName,
  current,
  saving,
  failed,
  onSave,
}: RoleOffDialogProps) {
  const { t } = useTranslation('settings');
  const { t: tAuth } = useTranslation('auth');
  const [picked, setPicked] = React.useState<UserRole[]>(current);
  // Each opening starts from what is saved.
  React.useEffect(() => {
    if (open) setPicked(current);
    // `current` is a fresh array per render; reset on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (role: UserRole, on: boolean) =>
    setPicked((p) => (on ? [...p, role] : p.filter((r) => r !== role)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('modulesWords.dialog.title', { module: moduleName })}</DialogTitle>
          <DialogDescription>
            {t('modulesWords.dialog.intro', { module: moduleName })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {HIDEABLE_ROLES.map((role) => (
            <li key={role}>
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={picked.includes(role)}
                  onCheckedChange={(v) => toggle(role, v === true)}
                />
                <span>{tAuth(`schoolPicker.roles.${role}`)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-text-secondary">{t('modulesWords.dialog.adminNote')}</p>
        {failed && (
          <p role="alert" className="text-destructive">
            {t('modulesWords.modules.notSaved')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t('modulesWords.dialog.cancel')}
          </Button>
          <Button className="min-h-11" disabled={saving} onClick={() => onSave(picked)}>
            {t('modulesWords.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
