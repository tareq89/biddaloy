import type { PrintElement } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { TFunction } from 'i18next';

/** ACR criterion slots (acr.criterion.N.label|label_bn|score): one label per slot type, numbered. */
export function slotLabel(t: TFunction<'printEditor'>, fieldKey: string) {
  const slot = /^acr\.criterion\.(\d+)\.(label|label_bn|score)$/.exec(fieldKey);
  return slot ? t(`fields.acr.criterion_${slot[2]}`, { n: slot[1] }) : undefined;
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
