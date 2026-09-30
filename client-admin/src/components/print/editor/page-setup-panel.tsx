/**
 * [32.3.2] Page setup (D19, D23, D36, D46): the template's name, paper, sides, batch
 * size and the copy-label text. Paper, sides and the copy label live in the DRAFT and
 * go through the same undo history and autosave as everything else; the name and the
 * batch size are template columns, saved when the field is committed.
 */
import { PRINT_BATCH_CEILING, type TemplateDefinition } from '@biddaloy/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { NumberField } from './properties-panel';

const CR80 = { long: 85.6, short: 54 } as const;
type Preset = 'CR80_PORTRAIT' | 'CR80_LANDSCAPE' | 'CUSTOM';

const PRESET_SIZE: Record<Exclude<Preset, 'CUSTOM'>, { widthMm: number; heightMm: number }> = {
  CR80_PORTRAIT: { widthMm: CR80.short, heightMm: CR80.long },
  CR80_LANDSCAPE: { widthMm: CR80.long, heightMm: CR80.short },
};

function presetOf(page: TemplateDefinition['page']): Preset {
  if (page.widthMm === CR80.short && page.heightMm === CR80.long) return 'CR80_PORTRAIT';
  if (page.widthMm === CR80.long && page.heightMm === CR80.short) return 'CR80_LANDSCAPE';
  return 'CUSTOM';
}

export interface PageSetupPanelProps {
  name: string;
  batchSize: number;
  page: TemplateDefinition['page'];
  copyLabel: string | undefined;
  onName: (name: string) => void;
  onBatchSize: (size: number) => void;
  onPage: (patch: { widthMm?: number; heightMm?: number; sides?: 'front' | 'both' }) => void;
  onCopyLabel: (text: string | undefined) => void;
}

export function PageSetupPanel({
  name,
  batchSize,
  page,
  copyLabel,
  onName,
  onBatchSize,
  onPage,
  onCopyLabel,
}: PageSetupPanelProps) {
  const { t } = useTranslation('printEditor');
  const [nameText, setNameText] = React.useState(name);
  const [labelText, setLabelText] = React.useState(copyLabel ?? '');
  React.useEffect(() => setNameText(name), [name]);
  React.useEffect(() => setLabelText(copyLabel ?? ''), [copyLabel]);

  const preset = presetOf(page);
  const example = (copyLabel ?? '').replace('{n}', '3');

  return (
    <section aria-label={t('page.title')} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">{t('page.title')}</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="page-name" className="text-xs font-medium">
          {t('page.name')}
        </label>
        <Input
          id="page-name"
          value={nameText}
          maxLength={80}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={() =>
            nameText.trim() !== '' && nameText.trim() !== name && onName(nameText.trim())
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <span id="page-paper-label" className="text-xs font-medium">
          {t('page.paper')}
        </span>
        <Select
          value={preset}
          onValueChange={(v) =>
            v !== 'CUSTOM' && onPage(PRESET_SIZE[v as Exclude<Preset, 'CUSTOM'>])
          }
        >
          <SelectTrigger aria-labelledby="page-paper-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['CR80_PORTRAIT', 'CR80_LANDSCAPE', 'CUSTOM'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`page.presets.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <NumberField
            id="page-width"
            label={t('page.width')}
            value={page.widthMm}
            min={10}
            max={600}
            onCommit={(v) => v !== undefined && onPage({ widthMm: v })}
          />
          <NumberField
            id="page-height"
            label={t('page.height')}
            value={page.heightMm}
            min={10}
            max={600}
            onCommit={(v) => v !== undefined && onPage({ heightMm: v })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span id="page-sides-label" className="text-xs font-medium">
          {t('page.sides')}
        </span>
        <Select
          value={page.sides.length === 2 ? 'both' : 'front'}
          onValueChange={(v) => onPage({ sides: v as 'front' | 'both' })}
        >
          <SelectTrigger aria-labelledby="page-sides-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['front', 'both'] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`page.sidesOptions.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <NumberField
        id="page-batch"
        label={t('page.batchSize')}
        value={batchSize}
        min={1}
        max={PRINT_BATCH_CEILING}
        step={1}
        help={t('page.batchHelp', { max: PRINT_BATCH_CEILING })}
        onCommit={(v) => v !== undefined && onBatchSize(Math.round(v))}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="page-copy-label" className="text-xs font-medium">
          {t('page.copyLabel')}
        </label>
        <Input
          id="page-copy-label"
          value={labelText}
          maxLength={40}
          aria-describedby="page-copy-label-help"
          onChange={(e) => setLabelText(e.target.value)}
          onBlur={() => {
            const next = labelText.trim();
            if (next !== (copyLabel ?? '')) onCopyLabel(next === '' ? undefined : next);
          }}
        />
        <p id="page-copy-label-help" className="text-xs text-muted-foreground">
          {t('page.copyLabelHelp')}
        </p>
        {example ? <p className="text-xs">{t('page.copyLabelExample', { example })}</p> : null}
      </div>
    </section>
  );
}
