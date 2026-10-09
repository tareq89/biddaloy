/** [48.3.B-01] Step 1: which certificate. A kind that cannot be issued is disabled with its reason (D4, D15). */
import { STUDENT_CERTIFICATE_KINDS, type DocumentKind } from '@biddaloy/shared';
import { Button, ChoiceCards } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';

import type { KindAvailability, KindRefusal } from './kind-eligibility';

const REASON_KEY: Record<KindRefusal, string> = {
  NO_LEAVING_EVENT: 'kind.noLeaving',
  NOT_CURRENT: 'kind.notCurrent',
  NOT_CURRENT_OR_GRADUATED: 'kind.notCurrentOrGraduated',
  NO_TEMPLATE: 'kind.noTemplate',
};

export function kindReasonKey(reason: string): string {
  return REASON_KEY[reason as KindRefusal] ?? 'kind.noLeaving';
}

export interface KindStepProps {
  value: DocumentKind | undefined;
  onChange: (kind: DocumentKind) => void;
  availability: Record<string, KindAvailability>;
  canManageTemplates: boolean;
  /** STUDENT_LIFECYCLE_MANAGE: only then is "Record leaving" offered (it opens the Leave dialog). */
  canManageLifecycle: boolean;
  onRecordLeaving: () => void;
}

export function KindStep({
  value,
  onChange,
  availability,
  canManageTemplates,
  canManageLifecycle,
  onRecordLeaving,
}: KindStepProps) {
  const { t } = useTranslation('certificates');
  const { t: tKind } = useTranslation('printHistory');
  const blocked = (kind: string) => {
    const a = availability[kind];
    return a && !a.ok ? a.reason : undefined;
  };
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-h2">{t('kind.label')}</h2>
      <ChoiceCards
        label={t('kind.label')}
        value={value}
        onValueChange={(v) => onChange(v as DocumentKind)}
        columns={2}
        options={STUDENT_CERTIFICATE_KINDS.map((kind) => {
          const reason = blocked(kind);
          return {
            value: kind,
            title: tKind(`kind.${kind}`),
            ...(reason ? { disabled: true, disabledReason: t(kindReasonKey(reason)) } : {}),
          };
        })}
      />
      {/* Fix links sit outside the radio group: a disabled card cannot hold a focusable link. */}
      <ul className="flex flex-col gap-1">
        {STUDENT_CERTIFICATE_KINDS.map((kind) => {
          const reason = blocked(kind);
          if (reason === 'NO_LEAVING_EVENT' && canManageLifecycle) {
            return (
              <li key={kind}>
                <Button type="button" variant="link" onClick={onRecordLeaving}>
                  {t('kind.recordLeaving')} ({tKind(`kind.${kind}`)})
                </Button>
              </li>
            );
          }
          if (reason === 'NO_TEMPLATE' && canManageTemplates) {
            return (
              <li key={kind}>
                <Link
                  to="/print-templates"
                  search={{ new: '1' } as never}
                  className="text-primary underline"
                >
                  {t('kind.createTemplate')} ({tKind(`kind.${kind}`)})
                </Link>
              </li>
            );
          }
          return null;
        })}
      </ul>
    </div>
  );
}
