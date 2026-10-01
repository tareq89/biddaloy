import type { PrintElement } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';

/** A readable name for a layer: the field's label, the fixed text, or the element's kind. */
export function useElementLabel(): (el: PrintElement) => string {
  const { t } = useTranslation('printEditor');
  return (el) => {
    switch (el.type) {
      case 'TEXT':
        return el.field !== undefined
          ? t(`fields.${el.field}`, { defaultValue: el.field })
          : t('layers.staticText', { text: el.text ?? '' });
      case 'IMAGE':
        return el.field !== undefined
          ? t(`fields.${el.field}`, { defaultValue: el.field })
          : t('layers.type.IMAGE');
      case 'QR':
        return t('layers.type.QR');
      case 'SHAPE':
        return t(`properties.shape.kinds.${el.shape}`, { defaultValue: el.shape });
    }
  };
}
