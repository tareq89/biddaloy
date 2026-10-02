/**
 * [32.3.7] Add / edit a printer profile (D7, D21, D26, D27, D37). The numbers
 * are in millimetres and are bounded here as well as on the server, so a typo
 * (an offset of 100 mm) is stopped before it prints a blank page.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import {
  useCreatePrinter,
  useUpdatePrinter,
  type CreatePrinterInput,
  type PrinterRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, type Control, type FieldPath } from 'react-hook-form';
import { z } from 'zod';

/** A Card printer prints edge to edge; an Office printer has a no-print band. */
const DEFAULT_MARGIN_MM = { CARD: 0, OFFICE: 5 } as const;
const DEFAULT_GAP_MM = 2;

/**
 * The schema is built per render with `t`, because `FormMessage` shows the
 * error's own message — so the messages must already be translated.
 */
function buildPrinterSchema(msg: (key: string) => string) {
  const bounded = (min: number, max: number, key: string) =>
    z
      .number({ message: msg(key) })
      .min(min, { message: msg(key) })
      .max(max, { message: msg(key) });
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, { message: msg('name') })
      .max(80, { message: msg('name') }),
    printer_type: z.enum(['CARD', 'OFFICE']),
    margin_top_mm: bounded(0, 20, 'margin'),
    margin_right_mm: bounded(0, 20, 'margin'),
    margin_bottom_mm: bounded(0, 20, 'margin'),
    margin_left_mm: bounded(0, 20, 'margin'),
    offset_x_mm: bounded(-10, 10, 'offset'),
    offset_y_mm: bounded(-10, 10, 'offset'),
    scale: bounded(0.9, 1.1, 'scale'),
    duplex_order: z.enum(['INTERLEAVED', 'GROUPED']),
    sheet_gap_mm: bounded(0, 20, 'gap'),
  });
}

type PrinterFormValues = z.infer<ReturnType<typeof buildPrinterSchema>>;

const MARGIN_FIELDS = [
  ['margin_top_mm', 'marginTop'],
  ['margin_right_mm', 'marginRight'],
  ['margin_bottom_mm', 'marginBottom'],
  ['margin_left_mm', 'marginLeft'],
] as const;

function defaultsFor(printer: PrinterRow | undefined): PrinterFormValues {
  if (printer) {
    return {
      name: printer.name,
      printer_type: printer.printer_type,
      margin_top_mm: printer.margin_top_mm,
      margin_right_mm: printer.margin_right_mm,
      margin_bottom_mm: printer.margin_bottom_mm,
      margin_left_mm: printer.margin_left_mm,
      offset_x_mm: printer.offset_x_mm,
      offset_y_mm: printer.offset_y_mm,
      scale: printer.scale,
      duplex_order: printer.duplex_order,
      sheet_gap_mm: printer.sheet_gap_mm,
    };
  }
  const margin = DEFAULT_MARGIN_MM.CARD;
  return {
    name: '',
    printer_type: 'CARD',
    margin_top_mm: margin,
    margin_right_mm: margin,
    margin_bottom_mm: margin,
    margin_left_mm: margin,
    offset_x_mm: 0,
    offset_y_mm: 0,
    scale: 1,
    duplex_order: 'INTERLEAVED',
    sheet_gap_mm: DEFAULT_GAP_MM,
  };
}

function NumberField({
  control,
  name,
  label,
  step,
  min,
  max,
}: {
  control: Control<PrinterFormValues>;
  name: FieldPath<PrinterFormValues>;
  label: string;
  step: number;
  min: number;
  max: number;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              step={step}
              min={min}
              max={max}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              // An empty box is NaN, which the schema rejects rather than silently reading as 0.
              value={
                typeof field.value === 'number' && !Number.isNaN(field.value) ? field.value : ''
              }
              onChange={(e) =>
                field.onChange(e.target.value === '' ? Number.NaN : e.target.valueAsNumber)
              }
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface PrinterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit this printer; absent = add a new one. */
  printer?: PrinterRow | undefined;
}

export function PrinterFormDialog({ open, onOpenChange, printer }: PrinterFormDialogProps) {
  const { t } = useTranslation('settings');
  const create = useCreatePrinter();
  const update = useUpdatePrinter(printer?.id ?? '');
  const mutation = printer ? update : create;

  const schema = React.useMemo(
    () => buildPrinterSchema((key) => t(`printers.form.errors.${key}`)),
    [t],
  );
  const form = useForm<PrinterFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(printer),
  });

  // Re-seed whenever the dialog opens for a different printer (or for "add").
  React.useEffect(() => {
    if (open) form.reset(defaultsFor(printer));
  }, [open, printer, form]);

  const type = form.watch('printer_type');

  /** Adding: switching type re-applies that type's default margins. Editing keeps the saved ones. */
  function handleTypeChange(next: 'CARD' | 'OFFICE') {
    form.setValue('printer_type', next, { shouldDirty: true });
    if (!printer) {
      for (const [field] of MARGIN_FIELDS) form.setValue(field, DEFAULT_MARGIN_MM[next]);
    }
  }

  function onSubmit(values: PrinterFormValues) {
    const input: CreatePrinterInput = {
      name: values.name.trim(),
      printer_type: values.printer_type,
      margin_top_mm: values.margin_top_mm,
      margin_right_mm: values.margin_right_mm,
      margin_bottom_mm: values.margin_bottom_mm,
      margin_left_mm: values.margin_left_mm,
      offset_x_mm: values.offset_x_mm,
      offset_y_mm: values.offset_y_mm,
      scale: values.scale,
      duplex_order: values.duplex_order,
      // The cutting gap only means something on an A4 sheet of cards.
      ...(values.printer_type === 'OFFICE' ? { sheet_gap_mm: values.sheet_gap_mm } : {}),
    };
    mutation.mutate(input, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {printer ? t('printers.form.editTitle') : t('printers.form.addTitle')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="flex flex-col gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('printers.form.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={80} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('printers.form.type')}</legend>
              <RadioGroup
                value={type}
                onValueChange={(v) => handleTypeChange(v as 'CARD' | 'OFFICE')}
              >
                {(['CARD', 'OFFICE'] as const).map((value) => (
                  <div key={value} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem id={`printer-type-${value}`} value={value} className="mt-0.5" />
                    <label htmlFor={`printer-type-${value}`}>
                      <span className="font-medium">{t(`printers.type.${value}`)}</span>
                      <span className="block text-muted-foreground">
                        {t(`printers.typeHelp.${value}`)}
                      </span>
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('printers.form.margins')}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {MARGIN_FIELDS.map(([name, labelKey]) => (
                  <NumberField
                    key={name}
                    control={form.control}
                    name={name}
                    label={t(`printers.form.${labelKey}`)}
                    step={0.5}
                    min={0}
                    max={20}
                  />
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-3 gap-3">
              <NumberField
                control={form.control}
                name="offset_x_mm"
                label={t('printers.form.offsetX')}
                step={0.1}
                min={-10}
                max={10}
              />
              <NumberField
                control={form.control}
                name="offset_y_mm"
                label={t('printers.form.offsetY')}
                step={0.1}
                min={-10}
                max={10}
              />
              <NumberField
                control={form.control}
                name="scale"
                label={t('printers.form.scale')}
                step={0.01}
                min={0.9}
                max={1.1}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('printers.form.duplex')}</legend>
              <RadioGroup
                value={form.watch('duplex_order')}
                onValueChange={(v) =>
                  form.setValue('duplex_order', v as 'INTERLEAVED' | 'GROUPED', {
                    shouldDirty: true,
                  })
                }
              >
                {(['INTERLEAVED', 'GROUPED'] as const).map((value) => (
                  <div key={value} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id={`printer-duplex-${value}`} value={value} />
                    <label htmlFor={`printer-duplex-${value}`}>
                      {t(`printers.duplex.${value}`)}
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            {type === 'OFFICE' ? (
              <NumberField
                control={form.control}
                name="sheet_gap_mm"
                label={t('printers.form.gap')}
                step={0.5}
                min={0}
                max={20}
              />
            ) : null}

            {mutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {t('printers.form.saveError')}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('printers.form.cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {mutation.isPending ? t('printers.form.saving') : t('printers.form.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
