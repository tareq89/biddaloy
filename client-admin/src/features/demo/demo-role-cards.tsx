import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  FolderIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  PresentationIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';

import type { DemoRoleCard } from './use-demo-mode';

const ROLE_ICONS: Record<string, LucideIcon> = {
  ADMIN: ShieldCheckIcon,
  EXECUTIVE: BriefcaseIcon,
  ACCOUNTANT: WalletIcon,
  TEACHER: PresentationIcon,
  EXAM_CONTROLLER: ClipboardCheckIcon,
  OFFICE_STAFF: FolderIcon,
  COMMITTEE: UsersIcon,
  PARENT: HeartHandshakeIcon,
  STUDENT: GraduationCapIcon,
};

export interface DemoRoleCardsProps {
  cards: readonly DemoRoleCard[];
  /** Called with the chosen card; the page signs in with its email and the shared demo password. */
  onPick: (card: DemoRoleCard) => void;
  disabled?: boolean;
  /** Focus the first card on mount (default). Off when the visitor is already typing elsewhere. */
  focusFirst?: boolean;
}

/** The "pick a role" grid on the demo login screen. The first card (Admin) is outlined and gets focus. */
export function DemoRoleCards({ cards, onPick, disabled, focusFirst = true }: DemoRoleCardsProps) {
  const { t, i18n } = useTranslation('demo');
  const bn = i18n.language.startsWith('bn');

  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => {
        const Icon = ROLE_ICONS[card.role] ?? UserRoundIcon;
        return (
          <li key={card.key} className="flex">
            <Card asChild padded className={index === 0 ? 'border-primary' : undefined}>
              <button
                // React focuses on mount only, so toggling the form later never pulls focus back.
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the cards are the page's main action
                autoFocus={focusFirst && index === 0}
                type="button"
                disabled={disabled}
                onClick={() => onPick(card)}
                className="flex w-full flex-col items-start gap-1 text-start transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
              >
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <span className="text-body-lg font-medium">
                  {t(`role.${card.key}`, { defaultValue: bn ? card.nameBn : card.nameEn })}
                </span>
                <span className="text-caption text-text-secondary">
                  {t(`branch.${card.branchSlug}`, { defaultValue: card.branchSlug })}
                </span>
                <span className="text-sm text-text-secondary">
                  {t('tryPrefix')} {t(`try.${card.tryKey}`, { defaultValue: card.tryKey })}
                </span>
              </button>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
