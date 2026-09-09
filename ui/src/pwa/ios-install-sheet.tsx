/**
 * [15.8.3] iOS never fires `beforeinstallprompt` (see
 * `use-install-prompt.ts`'s `isIosSafari` comment) — there is no native
 * install dialog to trigger on Safari for iPhone/iPad, only the manual
 * Share → Add to Home Screen path. This dialog explains those steps.
 * `staff-user-menu.tsx` opens it in place of calling `install()` whenever
 * `mode === 'ios-instructions'`.
 */
import { PlusSquareIcon, ShareIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/dialog';
import { useTranslation } from '../i18n';

export interface IosInstallSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IosInstallSheet({ open, onOpenChange }: IosInstallSheetProps) {
  const { t } = useTranslation('nav');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('installPrompt.iosSheet.title')}</DialogTitle>
          <DialogDescription>{t('installPrompt.iosSheet.description')}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-sm text-foreground">
          <li className="flex items-center gap-3">
            <ShareIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('installPrompt.iosSheet.step1')}
          </li>
          <li className="flex items-center gap-3">
            <PlusSquareIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('installPrompt.iosSheet.step2')}
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}
