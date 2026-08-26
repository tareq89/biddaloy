import { Input, Label } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/**
 * The WhatsApp approved-template fieldset both composers render when the
 * WHATSAPP channel is in play — one copy instead of the near-identical
 * pair the Send Message and Fee Reminders pages originally each carried.
 * The helper line (why a template is needed at all: the 24-hour freeform
 * reply window) is the one per-page string, passed in because each page
 * words it for its own flow.
 */
export interface WhatsappTemplateFieldsProps {
  idPrefix: string;
  helperText: string;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  templateLanguage: string;
  onTemplateLanguageChange: (value: string) => void;
  templateParams: string;
  onTemplateParamsChange: (value: string) => void;
}

/** The comma-separated params `Input` → the DTO's `string[]`, shared by
 * both pages' payload builders. */
export function splitTemplateParams(value: string): string[] {
  return value
    .split(',')
    .map((param) => param.trim())
    .filter((param) => param !== '');
}

export function WhatsappTemplateFields({
  idPrefix,
  helperText,
  templateName,
  onTemplateNameChange,
  templateLanguage,
  onTemplateLanguageChange,
  templateParams,
  onTemplateParamsChange,
}: WhatsappTemplateFieldsProps) {
  const { t } = useTranslation('communications');
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{helperText}</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-wa-template-name`}>{t('whatsapp.templateNameLabel')}</Label>
        <Input
          id={`${idPrefix}-wa-template-name`}
          value={templateName}
          onChange={(event) => onTemplateNameChange(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-wa-template-language`}>
          {t('whatsapp.templateLanguageLabel')}
        </Label>
        <Input
          id={`${idPrefix}-wa-template-language`}
          value={templateLanguage}
          onChange={(event) => onTemplateLanguageChange(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-wa-template-params`}>
          {t('whatsapp.templateParamsLabel')}
        </Label>
        <Input
          id={`${idPrefix}-wa-template-params`}
          value={templateParams}
          onChange={(event) => onTemplateParamsChange(event.target.value)}
        />
      </div>
    </section>
  );
}
