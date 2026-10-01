/**
 * [32.3.3] Import a designer's SVG (D6, D29). Pick a file, review the fields we found
 * and any warnings in plain words, then Import: the cleaned artwork is uploaded as this
 * side's background and the fields are added as elements, all in one undo step.
 */
import {
  PrintAssetKind,
  type DocumentKind,
  type PrintElement,
  type TemplateDefinition,
} from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileUpload,
} from '@biddaloy/ui/components';
import { useUploadPrintAsset } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../MutationErrorMessage';

import { importSvg, type Measure, type SvgImportResult } from './svg-import';

/** Passed as a value: i18next would read a literal `{{…}}` in the translation as a placeholder. */
const FIELD_EXAMPLE = '{{student.name}}';

export interface ImportSvgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: TemplateDefinition['page'];
  kind: DocumentKind;
  availableFonts: string[];
  /** Called once the artwork is uploaded. */
  onImport: (assetId: string, elements: PrintElement[]) => void;
  /** Tests only: jsdom cannot measure text. */
  measure?: Measure;
}

export function ImportSvgDialog({
  open,
  onOpenChange,
  page,
  kind,
  availableFonts,
  onImport,
  measure,
}: ImportSvgDialogProps) {
  const { t } = useTranslation('printEditor');
  const upload = useUploadPrintAsset();
  const [file, setFile] = React.useState<File | undefined>(undefined);
  const [result, setResult] = React.useState<SvgImportResult | undefined>(undefined);
  const [unreadable, setUnreadable] = React.useState(false);

  function reset() {
    setFile(undefined);
    setResult(undefined);
    setUnreadable(false);
    upload.reset();
  }

  async function handleFile(chosen: File) {
    setFile(chosen);
    setUnreadable(false);
    try {
      setResult(importSvg(await chosen.text(), page, kind, availableFonts, measure));
    } catch {
      setResult(undefined);
      setUnreadable(true);
    }
  }

  function handleImport() {
    if (!file || !result) return;
    const cleaned = new File([result.cleanedSvg], file.name, { type: 'image/svg+xml' });
    upload.mutate(
      { kind: PrintAssetKind.ARTWORK, file: cleaned },
      {
        onSuccess: (asset) => {
          onImport(asset.id, result.elements);
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  const w = result?.warnings;
  const fallback = new Set(w?.fontFallback.map((f) => f.field));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('svgImport.title')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t('svgImport.intro', { example: FIELD_EXAMPLE })}
        </p>
        <FileUpload
          items={file ? [{ id: file.name, file }] : []}
          multiple={false}
          accept=".svg"
          aria-label={t('svgImport.choose')}
          chooseLabel={t('svgImport.choose')}
          onFilesSelected={(files) => {
            const chosen = files[0];
            if (chosen) void handleFile(chosen);
          }}
          onRemove={reset}
        />

        {unreadable ? (
          <p role="alert" className="text-sm text-destructive">
            {t('svgImport.unreadable')}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-3">
            {result.elements.length === 0 ? (
              <p className="text-sm">{t('svgImport.none', { example: FIELD_EXAMPLE })}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col">{t('svgImport.colField')}</th>
                    <th scope="col">{t('svgImport.colPosition')}</th>
                    <th scope="col">{t('svgImport.colFont')}</th>
                    <th scope="col">{t('svgImport.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.elements.map((el) => {
                    const field = el.type === 'TEXT' && 'field' in el ? String(el.field) : '';
                    return (
                      <tr key={el.id}>
                        <td className="font-mono">{field}</td>
                        <td>{`${el.x} × ${el.y}`}</td>
                        <td>{el.type === 'TEXT' ? el.fontFamily : ''}</td>
                        <td>
                          {fallback.has(field)
                            ? t('svgImport.statusFont')
                            : t('svgImport.statusOk')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <ul className="flex flex-col gap-1 text-sm text-status-overdue-fg">
              {w?.aspect ? (
                <li>
                  {t('svgImport.warnAspect', {
                    svg: `${w.aspect.svgWidth}×${w.aspect.svgHeight}`,
                    page: `${page.widthMm}×${page.heightMm}`,
                  })}
                </li>
              ) : null}
              {w?.unknown.map((key) => (
                <li key={`u-${key}`}>{t('svgImport.warnUnknown', { key })}</li>
              ))}
              {w?.mixed.map((text) => (
                <li key={`m-${text}`}>{t('svgImport.warnMixed', { text })}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {upload.isError ? <MutationErrorMessage error={upload.error} /> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {t('svgImport.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!result}
            loading={upload.isPending}
            onClick={handleImport}
          >
            {t('svgImport.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
