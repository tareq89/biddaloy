/**
 * [32.3.6] Create a template from one of the seeded designs (D11, D50, D51):
 * pick the document type, pick a design, name it, create — then the caller opens
 * the editor. A school starts with no templates, so this is the first thing many
 * people see; the design can also be pre-picked (the empty state's grid).
 */
import { DocumentKind } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@biddaloy/ui/components';
import { useCreatePrintTemplate, usePrintSuggestions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { SuggestionCard } from './suggestion-card';

const KINDS = [DocumentKind.STUDENT_ID_CARD, DocumentKind.STAFF_ID_CARD] as const;

export interface NewTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new template's id once it exists. */
  onCreated: (templateId: string) => void;
  /** Start with this design already chosen (its document type is used too). */
  initialSuggestionKey?: string;
}

export function NewTemplateDialog({
  open,
  onOpenChange,
  onCreated,
  initialSuggestionKey,
}: NewTemplateDialogProps) {
  const { t } = useTranslation('printTemplates');
  const suggestionsQuery = usePrintSuggestions();
  const create = useCreatePrintTemplate();
  const suggestions = React.useMemo(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);

  const initial = suggestions.find((s) => s.key === initialSuggestionKey);
  const [kind, setKind] = React.useState<string>(initial?.documentKind ?? KINDS[0]);
  const [selectedKey, setSelectedKey] = React.useState<string | undefined>(initialSuggestionKey);
  // `undefined` = follow the design's default name until the person types their own.
  const [typedName, setTypedName] = React.useState<string | undefined>(undefined);

  const shown = suggestions.filter((s) => s.documentKind === kind);
  const selected = suggestions.find((s) => s.key === selectedKey);
  const defaultName = selected
    ? t('defaultName', {
        style: t(`style.${selected.style}`),
        orientation: t(`orientation.${selected.orientation}`),
      })
    : '';
  const name = typedName ?? defaultName;
  const canCreate = Boolean(selected) && name.trim() !== '' && !create.isPending;

  function handleOpenChange(next: boolean) {
    if (!next) {
      create.reset();
      setTypedName(undefined);
    }
    onOpenChange(next);
  }

  function handleCreate() {
    if (!selected || !canCreate) return;
    create.mutate(
      { name: name.trim(), suggestion_key: selected.key },
      {
        onSuccess: (template) => {
          handleOpenChange(false);
          onCreated(template.id);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('new_dialog.title')}</DialogTitle>
        </DialogHeader>

        <div role="group" aria-label={t('new_dialog.kind')} className="flex gap-2">
          {KINDS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={kind === value ? 'default' : 'outline'}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setSelectedKey(undefined);
                setTypedName(undefined);
              }}
            >
              {t(`kind.${value}`)}
            </Button>
          ))}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('new_dialog.designs')}</legend>
          {shown.length === 0 && !suggestionsQuery.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('new_dialog.noSuggestions')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shown.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.key}
                  suggestion={suggestion}
                  selected={suggestion.key === selectedKey}
                  onSelect={(key) => {
                    setSelectedKey(key);
                    setTypedName(undefined);
                  }}
                />
              ))}
            </div>
          )}
        </fieldset>

        {selected ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-template-name" className="text-sm font-medium">
              {t('new_dialog.name')}
            </label>
            <Input
              id="new-template-name"
              value={name}
              maxLength={80}
              onChange={(e) => setTypedName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('new_dialog.nameHelp')}</p>
          </div>
        ) : null}

        {create.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('new_dialog.createFailed')}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t('new_dialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canCreate}
            loading={create.isPending}
            onClick={handleCreate}
          >
            {create.isPending ? t('new_dialog.creating') : t('new_dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
