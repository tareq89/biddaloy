/**
 * [32.3.5] One past print, shown exactly as printed (D9, D59): the stored
 * snapshot rendered with the stored template version, so a card can be recreated
 * years later even if the template has changed since.
 *
 * The QR code is deliberately absent: only a hash of the verify token is stored
 * (a stolen backup must not yield working tokens), so it can't be redrawn. A
 * reprint mints a new one.
 */
import { getActiveTenant } from '@biddaloy/ui/api';
import {
  BUNDLED_PRINT_FONTS,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  TemplateRenderer,
} from '@biddaloy/ui/components';
import { usePrintHistoryItem, type PrintHistoryItemDetail } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

import { useDataUrls } from '../preview/use-data-urls';

export interface HistoryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | undefined;
  /** Only shown for a copy that is still valid. */
  onReprint?: (item: PrintHistoryItemDetail) => void;
  onRevoke?: (item: PrintHistoryItemDetail) => void;
}

/** Every string under `key` anywhere in the (JSON) definition. */
function collect(value: unknown, key: string, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collect(v, key, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === key && typeof v === 'string') into.add(v);
      else collect(v, key, into);
    }
  }
  return into;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value == null ? '' : JSON.stringify(value);
}

function ItemBody({
  itemId,
  onReprint,
  onRevoke,
}: {
  itemId: string;
  onReprint: HistoryItemDialogProps['onReprint'];
  onRevoke: HistoryItemDialogProps['onRevoke'];
}) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const query = usePrintHistoryItem(itemId);
  const item = query.data;

  const definition = item?.template_definition;
  const snapshot = item?.data_snapshot;
  const prefix = item?.subject_type === 'STAFF' ? 'staff' : 'student';
  const photoUrl =
    item && snapshot?.photoKey && item.subject_id
      ? `/print-jobs/photo?subject_type=${item.subject_type}&subject_id=${item.subject_id}&key=${encodeURIComponent(snapshot.photoKey)}`
      : undefined;
  const wantsLogo = Boolean(snapshot?.values['school.logo']);
  const logoUrl = `/schools/${getActiveTenant() ?? ''}/logo`;
  const assetUrls = definition
    ? [...collect(definition, 'assetId'), ...collect(definition, 'fontAssetId')].map(
        (id) => `/print-assets/${id}/file`,
      )
    : [];
  const dataUrls = useDataUrls([
    ...assetUrls,
    ...(photoUrl ? [photoUrl] : []),
    ...(wantsLogo ? [logoUrl] : []),
  ]);

  if (query.isPending)
    return <Skeleton role="status" aria-label={t('item.loading')} className="h-40 w-full" />;
  if (query.isError || !item || !definition || !snapshot) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('item.error')}
      </p>
    );
  }

  const values = {
    ...(Object.fromEntries(Object.entries(snapshot.values).map(([k, v]) => [k, text(v)])) as Record<
      string,
      string
    >),
    [`${prefix}.photo`]: photoUrl ? (dataUrls[photoUrl] ?? '') : '',
    'school.logo': wantsLogo ? (dataUrls[logoUrl] ?? '') : '',
  };
  const revoked = item.revoked_at !== null;

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('item.printedBy')}</dt>
        <dd>{item.printed_by_name ?? t('system')}</dd>
        <dt className="text-muted-foreground">{t('item.printedAt')}</dt>
        <dd>{formatDateTime(new Date(item.created_at), region)}</dd>
        <dt className="text-muted-foreground">{t('item.copy')}</dt>
        <dd>{t('copyValue', { n: item.copy_number })}</dd>
        <dt className="text-muted-foreground">{t('item.status')}</dt>
        <dd>{revoked ? t('status.REVOKED') : t('status.VALID')}</dd>
        {revoked && item.revoke_reason ? (
          <>
            <dt className="text-muted-foreground">{t('item.reason')}</dt>
            <dd>{item.revoke_reason}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-3 overflow-x-auto">
        {definition.page.sides.map((side) => (
          <figure key={side} className="flex flex-col gap-1">
            <TemplateRenderer
              definition={definition}
              side={side}
              values={values}
              assetUrl={(id) => dataUrls[`/print-assets/${id}/file`] ?? ''}
              fonts={BUNDLED_PRINT_FONTS}
              mode="preview"
              copy={snapshot.copyNumber}
            />
            <figcaption className="text-xs text-muted-foreground">{t(`item.${side}`)}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('item.qrNote')}</p>

      <DialogFooter>
        {!revoked && onReprint ? (
          <Button type="button" variant="outline" onClick={() => onReprint(item)}>
            {t('actions.reprint')}
          </Button>
        ) : null}
        {!revoked && onRevoke ? (
          <Button type="button" variant="destructive" onClick={() => onRevoke(item)}>
            {t('actions.revoke')}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

export function HistoryItemDialog({
  open,
  onOpenChange,
  itemId,
  onReprint,
  onRevoke,
}: HistoryItemDialogProps) {
  const { t } = useTranslation('printHistory');
  return (
    <Dialog open={open && itemId !== undefined} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('item.title')}</DialogTitle>
        </DialogHeader>
        {open && itemId ? (
          <ItemBody itemId={itemId} onReprint={onReprint} onRevoke={onRevoke} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
