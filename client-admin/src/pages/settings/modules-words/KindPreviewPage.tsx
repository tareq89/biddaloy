import type { ModuleKey } from '@biddaloy/shared';
import { ErrorState, Skeleton, toast } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { CircleCheckIcon, CircleMinusIcon, InfoIcon } from 'lucide-react';

import {
  type InstitutionKind,
  type KindChanges,
  useApplyKind,
  useInstitutionKinds,
  useKindPreview,
} from './use-institution-kinds';

type WordEntry = { en?: { one?: string; other?: string }; bn?: string } | null;

export interface KindPreviewPageProps {
  kindId: string;
  /** Called on Cancel, Close and after a successful Apply. */
  onClose: () => void;
}

function ModuleList(props: {
  title: string;
  keys: readonly string[];
  icon: React.ReactNode;
  names: (key: string) => string;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
      <h2 className="text-h2">{props.title}</h2>
      <ul className="mt-2">
        {props.keys.map((key) => (
          <li key={key} className="flex items-center gap-2 py-1">
            {props.icon}
            <span>{props.names(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PreviewBody({ changes, kind }: { changes: KindChanges; kind: InstitutionKind }) {
  const { t, i18n } = useTranslation('settings');
  const bn = i18n.language.startsWith('bn');
  const on = changes.modules.filter((m) => m.to).map((m) => m.key);
  const off = changes.modules.filter((m) => !m.to).map((m) => m.key);
  const moduleName = (key: string) =>
    t(`modulesWords.moduleNames.${key as ModuleKey}`, { defaultValue: key });
  const labelName = (key: string) => t(`modulesWords.labelNames.${key}`, { defaultValue: key });
  // Both languages, like the mockup: "Section / Batch". `one` is the singular English word.
  const word = (entry: WordEntry | undefined, key: string) => {
    const en = entry?.en?.one;
    const b = entry?.bn;
    return en || b ? [bn ? b : en, bn ? en : b].filter(Boolean).join(' / ') : labelName(key);
  };
  const empty = changes.modules.length === 0 && changes.labels.length === 0;

  return (
    <>
      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-muted p-3">
        <InfoIcon className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {t('modulesWords.preview.note')} {t('modulesWords.preview.stays')}
        </span>
      </p>
      {empty ? (
        <p className="text-text-secondary">
          {t('modulesWords.preview.nothingToChange', {
            kind: bn ? kind.name.bn : kind.name.en,
          })}
        </p>
      ) : (
        <>
          {(on.length > 0 || off.length > 0) && (
            <div className="grid gap-6 md:grid-cols-2">
              {on.length > 0 && (
                <ModuleList
                  title={t('modulesWords.preview.willBeOn')}
                  keys={on}
                  names={moduleName}
                  icon={
                    <CircleCheckIcon className="size-4 text-status-paid-fg" aria-hidden="true" />
                  }
                />
              )}
              {off.length > 0 && (
                <ModuleList
                  title={t('modulesWords.preview.willBeOff')}
                  keys={off}
                  names={moduleName}
                  icon={
                    <CircleMinusIcon className="size-4 text-text-secondary" aria-hidden="true" />
                  }
                />
              )}
            </div>
          )}
          {changes.labels.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-h2">{t('modulesWords.preview.wordsChange')}</h2>
              <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
                <table className="w-full text-left">
                  <caption className="sr-only">{t('modulesWords.preview.wordsChange')}</caption>
                  <thead className="border-b border-border-subtle bg-muted text-label text-text-secondary">
                    <tr>
                      <th scope="col" className="h-10 px-4 font-medium">
                        {t('modulesWords.preview.now')}
                      </th>
                      <th scope="col" className="h-10 px-4 font-medium">
                        {t('modulesWords.preview.willBe')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {changes.labels.map((l) => (
                      <tr key={l.key}>
                        <td className="px-4 py-2">{word(l.from as WordEntry, l.key)}</td>
                        <td className="px-4 py-2 font-medium">{word(l.to as WordEntry, l.key)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * D28/D30: the preview of one institution kind, a full-page modal. Read-only until Apply
 * (D24). A failed Apply keeps the person here with a fixed sentence, never the server's text,
 * and is never retried by itself (Rule 25).
 */
export function KindPreviewPage({ kindId, onClose }: KindPreviewPageProps) {
  const { t, i18n } = useTranslation('settings');
  const kinds = useInstitutionKinds();
  const kind = kinds.data?.find((k) => k.id === kindId);
  const preview = useKindPreview(kindId);
  const apply = useApplyKind();

  const name = kind ? (i18n.language.startsWith('bn') ? kind.name.bn : kind.name.en) : '';
  const changes = preview.data;
  const noChanges = changes !== undefined && changes.modules.length + changes.labels.length === 0;
  const failed = preview.isError || (kinds.isSuccess && !kind);

  function onApply() {
    apply.mutate(kindId, {
      onSuccess: () => {
        toast.success(t('modulesWords.preview.applied', { kind: name }));
        onClose();
      },
    });
  }

  return (
    <FullPageShell
      title={t('modulesWords.preview.title', { kind: name })}
      onClose={onClose}
      size="wide"
      secondary={{ label: t('modulesWords.preview.cancel'), onClick: onClose }}
      primary={{
        label: t('modulesWords.preview.apply'),
        onClick: onApply,
        busy: apply.isPending,
        disabled: !changes || !kind || noChanges,
        ...(noChanges ? { disabledReason: t('modulesWords.preview.nothingToApply') } : {}),
      }}
    >
      {apply.isError && (
        <p role="alert" className="text-destructive">
          {t('modulesWords.preview.applyError')}
        </p>
      )}
      {failed ? (
        <ErrorState
          message={t('modulesWords.preview.loadError')}
          onRetry={() => {
            void kinds.refetch();
            void preview.refetch();
          }}
        />
      ) : !changes || !kind ? (
        <div className="space-y-4" aria-busy="true" aria-label={t('modulesWords.preview.loading')}>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <PreviewBody changes={changes} kind={kind} />
      )}
    </FullPageShell>
  );
}
