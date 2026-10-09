import { DiscountKind, FeeType } from '@biddaloy/shared';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  MultiCombobox,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormContext, useWatch } from 'react-hook-form';

import { DateField, TextField } from './fields';

const KIND_CARD =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground';

export function FeeWaiverFields() {
  const { t } = useTranslation('applicationForms');
  const { t: tFee } = useTranslation('feeStructures');
  const { control } = useFormContext();
  const [kind, start] = useWatch({ name: ['kind', 'start_date'] }) as [string, string];

  return (
    <>
      <FormField
        control={control}
        name="kind"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel required>{t('fields.kind')}</FormLabel>
            <FormControl>
              <RadioGroup
                aria-label={t('fields.kind')}
                value={field.value as string}
                onValueChange={field.onChange}
                className="grid grid-cols-2 gap-2 md:max-w-sm"
              >
                {[DiscountKind.PERCENT, DiscountKind.FLAT].map((k) => (
                  <label key={k} className={KIND_CARD}>
                    <RadioGroupItem value={k} />
                    {t(`kinds.${k}`)}
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <TextField
        name="value"
        inputMode="decimal"
        label={t(
          kind === (DiscountKind.PERCENT as string) ? 'fields.valuePercent' : 'fields.valueFlat',
        )}
      />
      <FormField
        control={control}
        name="fee_types"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.feeTypes')}</FormLabel>
            <FormControl>
              <MultiCombobox
                aria-label={t('fields.feeTypes')}
                options={Object.values(FeeType).map((v) => ({
                  value: v,
                  label: tFee(`feeTypes.${v}`),
                }))}
                value={field.value as string[]}
                onValueChange={field.onChange}
              />
            </FormControl>
            <FormDescription>{t('help.feeTypesAll')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <DateField name="start_date" label={t('fields.waiverStart')} required={false} />
      <DateField name="end_date" label={t('fields.waiverEnd')} required={false} min={start} />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}
