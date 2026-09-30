/**
 * [32.3.2] Files for the design (D8, D24, D37): the background artwork for the side
 * being edited, images (a signature, a seal) to place, and fonts. Uploads go to the
 * server, which checks the real file content and cleans SVGs; whatever it refuses is
 * shown here verbatim.
 */
import { PrintAssetKind } from '@biddaloy/shared';
import { Button, FileUpload, Input } from '@biddaloy/ui/components';
import { usePrintAssets, useUploadPrintAsset, type PrintAssetRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../MutationErrorMessage';

import { DpiBadge } from './dpi-badge';

export interface AssetsPanelProps {
  pageWidthMm: number;
  background: { assetId: string; print: boolean } | undefined;
  onSetBackground: (assetId: string | null, print?: boolean) => void;
  onInsertImage: (assetId: string) => void;
}

export function AssetsPanel({
  pageWidthMm,
  background,
  onSetBackground,
  onInsertImage,
}: AssetsPanelProps) {
  const { t } = useTranslation('printEditor');
  const assetsQuery = usePrintAssets();
  const upload = useUploadPrintAsset();
  const [fontName, setFontName] = React.useState('');
  const [fontRights, setFontRights] = React.useState(false);
  const [fontFile, setFontFile] = React.useState<File | undefined>(undefined);

  const assets = (assetsQuery.data ?? []).filter((a) => a.archived_at === null);
  const byKind = (kind: PrintAssetKind) => assets.filter((a) => a.asset_kind === kind);
  const backgroundAsset = background ? assets.find((a) => a.id === background.assetId) : undefined;
  const canUploadFont = fontName.trim() !== '' && fontRights && fontFile !== undefined;

  function send(
    kind: PrintAssetKind,
    file: File,
    onDone?: (asset: PrintAssetRow) => void,
    fontFamily?: string,
  ) {
    upload.mutate(
      { kind, file, ...(fontFamily ? { fontFamily } : {}) },
      { onSuccess: (asset) => onDone?.(asset) },
    );
  }

  return (
    <section aria-label={t('assets.title')} className="flex flex-col gap-5">
      <h2 className="text-sm font-semibold">{t('assets.title')}</h2>

      {/* ---- background of this side ---- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">{t('assets.background')}</h3>
        {background && backgroundAsset ? (
          <>
            <p className="truncate text-sm">{backgroundAsset.original_name}</p>
            <DpiBadge widthPx={backgroundAsset.width_px} elementWidthMm={pageWidthMm} />
            <div className="flex items-center gap-2 text-sm">
              <input
                id="print-background"
                type="checkbox"
                checked={background.print}
                aria-describedby="print-background-help"
                onChange={(e) => onSetBackground(background.assetId, e.target.checked)}
              />
              <label htmlFor="print-background">{t('assets.printBackground')}</label>
            </div>
            <p id="print-background-help" className="text-xs text-muted-foreground">
              {t('assets.printBackgroundHelp')}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => onSetBackground(null)}
            >
              {t('assets.removeBackground')}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('assets.backgroundNone')}</p>
        )}
        <FileUpload
          items={[]}
          multiple={false}
          accept=".svg,.png,.jpg,.jpeg"
          disabled={upload.isPending}
          aria-label={t('assets.backgroundChoose')}
          chooseLabel={t('assets.backgroundChoose')}
          onFilesSelected={(files) => {
            const file = files[0];
            if (file)
              send(PrintAssetKind.ARTWORK, file, (asset) =>
                onSetBackground(asset.id, background?.print ?? true),
              );
          }}
        />
        <p className="text-xs text-muted-foreground">{t('assets.backgroundAccept')}</p>
      </div>

      {/* ---- images to place ---- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">{t('assets.images')}</h3>
        {byKind(PrintAssetKind.IMAGE).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assets.imagesNone')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {byKind(PrintAssetKind.IMAGE).map((asset) => (
              <li key={asset.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{asset.original_name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onInsertImage(asset.id)}
                >
                  {t('assets.insert')}
                  <span className="sr-only"> {asset.original_name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <FileUpload
          items={[]}
          multiple={false}
          accept=".png,.jpg,.jpeg,.svg"
          disabled={upload.isPending}
          aria-label={t('assets.upload')}
          chooseLabel={t('assets.upload')}
          onFilesSelected={(files) => {
            const file = files[0];
            if (file) send(PrintAssetKind.IMAGE, file);
          }}
        />
      </div>

      {/* ---- fonts ---- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">{t('assets.fonts')}</h3>
        {byKind(PrintAssetKind.FONT).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assets.fontsNone')}</p>
        ) : (
          <ul className="text-sm">
            {byKind(PrintAssetKind.FONT).map((asset) => (
              <li key={asset.id}>{asset.font_family ?? asset.original_name}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="font-name" className="text-xs font-medium">
            {t('assets.fontName')}
          </label>
          <Input
            id="font-name"
            value={fontName}
            maxLength={80}
            onChange={(e) => setFontName(e.target.value)}
          />
        </div>
        <FileUpload
          items={fontFile ? [{ id: fontFile.name, file: fontFile }] : []}
          multiple={false}
          accept=".ttf,.otf,.woff2"
          disabled={upload.isPending}
          aria-label={t('assets.fontFile')}
          chooseLabel={t('assets.fontFile')}
          onFilesSelected={(files) => setFontFile(files[0])}
          onRemove={() => setFontFile(undefined)}
        />
        <div className="flex items-center gap-2 text-sm">
          <input
            id="font-rights"
            type="checkbox"
            checked={fontRights}
            onChange={(e) => setFontRights(e.target.checked)}
          />
          <label htmlFor="font-rights">{t('assets.fontRights')}</label>
        </div>
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={!canUploadFont}
          loading={upload.isPending}
          onClick={() => {
            if (!fontFile) return;
            send(
              PrintAssetKind.FONT,
              fontFile,
              () => {
                setFontFile(undefined);
                setFontName('');
                setFontRights(false);
              },
              fontName.trim(),
            );
          }}
        >
          {t('assets.fontUpload')}
        </Button>
      </div>

      {upload.isError ? <MutationErrorMessage error={upload.error} /> : null}
    </section>
  );
}
