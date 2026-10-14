import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  FolderIcon,
  GraduationCapIcon,
  PresentationIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import type { DemoRoleCard } from './use-demo-mode';

const ROLE_ICONS: Record<string, LucideIcon> = {
  ADMIN: ShieldCheckIcon,
  EXECUTIVE: BriefcaseIcon,
  ACCOUNTANT: WalletIcon,
  TEACHER: PresentationIcon,
  EXAM_CONTROLLER: ClipboardCheckIcon,
  OFFICE_STAFF: FolderIcon,
  COMMITTEE: UsersIcon,
  PARENT: UsersIcon,
  STUDENT: GraduationCapIcon,
};

export interface DemoRoleCardsProps {
  cards: readonly DemoRoleCard[];
  /** Called with the chosen card; the page signs in with its email and the shared demo password. */
  onPick: (card: DemoRoleCard) => void;
  disabled?: boolean;
}

/** The "pick a role" grid on the demo login screen. The first card (Admin) is outlined and gets focus. */
export function DemoRoleCards({ cards, onPick, disabled }: DemoRoleCardsProps) {
  const { t, i18n } = useTranslation('demo');
  const first = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => first.current?.focus(), []);
  const bn = i18n.language.startsWith('bn');

  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => {
        const Icon = ROLE_ICONS[card.role] ?? UserRoundIcon;
        return (
          <li key={card.key} className="flex">
            <Card asChild padded className={index === 0 ? 'border-primary' : undefined}>
              <button
                ref={index === 0 ? first : undefined}
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
