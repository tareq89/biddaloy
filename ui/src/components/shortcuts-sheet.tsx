/**
 * [30.4.1] `?` opens this keyboard-shortcuts help — a `Dialog`, not a
 * route (`docs/architecture/15-ux-principles.md` §4). It has no URL and
 * is never in `route-manifest.json`; the caller wires the `?` global
 * listener and owns `open` state, same shape as `command-palette.tsx`'s
 * own Cmd/Ctrl+K.
 *
 * Unlike `GlobalSearch`/`CommandPalette`'s literal-fallback strings, this
 * content is real user-facing help copy shown outside any query flow, so
 * it goes through `common:shortcuts.*` (`useTranslation('common')`) —
 * same reasoning as `access-denied-state.tsx`'s file comment for why that
 * component supplies its own translated copy rather than prop-drilling
 * English.
 */
import { useTranslation } from '../i18n';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

export interface ShortcutsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutRow {
  keys: readonly string[];
  labelKey: string;
}

const ROWS: readonly ShortcutRow[] = [
  { keys: ['Ctrl/⌘', 'K'], labelKey: 'openPalette' },
  { keys: ['?'], labelKey: 'openShortcuts' },
  { keys: ['←', '→'], labelKey: 'switchTab' },
  { keys: ['Ctrl', '1-3'], labelKey: 'jumpTab' },
  { keys: ['/'], labelKey: 'jumpPageTab' },
  { keys: ['>'], labelKey: 'jumpActionTab' },
  { keys: ['↑', '↓'], labelKey: 'moveSelection' },
  { keys: ['Enter'], labelKey: 'openSelection' },
  { keys: ['Esc'], labelKey: 'close' },
];

export function ShortcutsSheet({ open, onOpenChange }: ShortcutsSheetProps) {
  const { t } = useTranslation('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2">
          {ROWS.map((row) => (
            <div key={row.labelKey} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{t(`shortcuts.rows.${row.labelKey}`)}</dt>
              <dd className="flex items-center gap-1">
                {row.keys.map((key, index) => (
                  <kbd
                    key={`${row.labelKey}-${index}`}
                    className="rounded-md border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-xs"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
