import type { PrintElement } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { TFunction } from 'i18next';

/**
 * Numbered slots: ACR criteria (acr.criterion.N.label|label_bn|score) and admit-card sittings
 * (exam.sitting.N.subject|date|time|room|seat). One label per slot type, numbered.
 */
export function slotLabel(t: TFunction<'printEditor'>, fieldKey: string) {
  const acr = /^acr\.criterion\.(\d+)\.(label|label_bn|score)$/.exec(fieldKey);
  if (acr) return t(`fields.acr.criterion_${acr[2]}`, { n: acr[1] });
  const sitting = /^exam\.sitting\.(\d+)\.(subject|date|time|room|seat)$/.exec(fieldKey);
  return sitting ? t(`fields.exam.sitting_${sitting[2]}`, { n: Number(sitting[1]) }) : undefined;
}

/** A readable name for a layer: the field's label, the fixed text, or the element's kind. */
export function useElementLabel(): (el: PrintElement) => string {
  const { t } = useTranslation('printEditor');
  return (el) => {
    switch (el.type) {
      case 'TEXT':
        return el.field !== undefined
          ? (slotLabel(t, el.field) ?? t(`fields.${el.field}`, { defaultValue: el.field }))
          : t('layers.staticText', { text: el.text ?? '' });
      case 'IMAGE':
        return el.field !== undefined
          ? (slotLabel(t, el.field) ?? t(`fields.${el.field}`, { defaultValue: el.field }))
          : t('layers.type.IMAGE');
      case 'QR':
        return t('layers.type.QR');
      case 'SHAPE':
        return t(`properties.shape.kinds.${el.shape}`, { defaultValue: el.shape });
    }
  };
}
