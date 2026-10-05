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
  FormDescription,
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
import { ChevronRightIcon, CircleAlertIcon } from 'lucide-react';
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
  help,
}: {
  control: Control<PrinterFormValues>;
  name: FieldPath<PrinterFormValues>;
  label: string;
  step: number;
  min: number;
  max: number;
  help?: string;
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
          {help && <FormDescription>{help}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Radio option as a selectable card (patterns §6). */
const OPTION_CARD =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary';

const ADVANCED_FIELDS = [
  'margin_top_mm',
  'margin_right_mm',
  'margin_bottom_mm',
  'margin_left_mm',
  'offset_x_mm',
  'offset_y_mm',
  'scale',
] as const;

export interface PrinterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit this printer; absent = add a new one. */
  printer?: PrinterRow | undefined;
  /** Open the "Measurements" disclosure (the calibration guide's shortcut). */
  openAdvanced?: boolean;
}

export function PrinterFormDialog({
  open,
  onOpenChange,
  printer,
  openAdvanced,
}: PrinterFormDialogProps) {
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
  // `mutation.reset()` too: an earlier save error must not greet the next open.
  React.useEffect(() => {
    if (open) {
      form.reset(defaultsFor(printer));
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, printer, form]);

  const type = form.watch('printer_type');
  const hasAdvancedError = ADVANCED_FIELDS.some((f) => form.formState.errors[f] !== undefined);

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
      <DialogContent size="md">
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
                  <FormLabel required>{t('printers.form.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={80} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <fieldset>
              <legend className="text-label text-text-primary">{t('printers.form.type')}</legend>
              <RadioGroup
                className="mt-1.5 grid gap-2 md:grid-cols-2"
                value={type}
                onValueChange={(v) => handleTypeChange(v as 'CARD' | 'OFFICE')}
              >
                {(['CARD', 'OFFICE'] as const).map((value) => (
                  <label key={value} htmlFor={`printer-type-${value}`} className={OPTION_CARD}>
                    <RadioGroupItem id={`printer-type-${value}`} value={value} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{t(`printers.type.${value}`)}</span>
                      <span className="block text-text-secondary">
                        {t(`printers.typeHelp.${value}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            <fieldset>
              <legend className="text-label text-text-primary">{t('printers.form.duplex')}</legend>
              <RadioGroup
                className="mt-1.5 grid gap-2 md:grid-cols-2"
                value={form.watch('duplex_order')}
                onValueChange={(v) =>
                  form.setValue('duplex_order', v as 'INTERLEAVED' | 'GROUPED', {
                    shouldDirty: true,
                  })
                }
              >
                {(['INTERLEAVED', 'GROUPED'] as const).map((value) => (
                  <label key={value} htmlFor={`printer-duplex-${value}`} className={OPTION_CARD}>
                    <RadioGroupItem
                      id={`printer-duplex-${value}`}
                      value={value}
                      className="mt-0.5"
                    />
                    <span className="font-medium">{t(`printers.duplex.${value}`)}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            {type === 'OFFICE' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <NumberField
                  control={form.control}
                  name="sheet_gap_mm"
                  label={t('printers.form.gap')}
                  help={t('printers.form.gapHelp')}
                  step={0.5}
                  min={0}
                  max={20}
                />
              </div>
            ) : null}

            <details
              className="group/adv border-t border-border-subtle pt-2"
              open={openAdvanced || hasAdvancedError || undefined}
            >
              <summary className="flex h-11 cursor-pointer list-none items-center gap-1 font-medium text-text-secondary md:h-8">
                <ChevronRightIcon aria-hidden="true" className="size-4 group-open/adv:rotate-90" />
                {t('printers.form.advanced')}
              </summary>
              <p className="mt-2 text-caption text-text-secondary">
                {t('printers.form.advancedHelp')}
              </p>
              <fieldset className="mt-4">
                <legend className="text-label text-text-primary">
                  {t('printers.form.margins')}
                </legend>
                <div className="mt-1.5 grid grid-cols-2 gap-4 md:grid-cols-4">
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
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <NumberField
                  control={form.control}
                  name="offset_x_mm"
                  label={t('printers.form.offsetX')}
                  help={t('printers.form.offsetHelp')}
                  step={0.1}
                  min={-10}
                  max={10}
                />
                <NumberField
                  control={form.control}
                  name="offset_y_mm"
                  label={t('printers.form.offsetY')}
                  help={t('printers.form.offsetHelp')}
                  step={0.1}
                  min={-10}
                  max={10}
                />
                <NumberField
                  control={form.control}
                  name="scale"
                  label={t('printers.form.scale')}
                  help={t('printers.form.scaleHelp')}
                  step={0.01}
                  min={0.9}
                  max={1.1}
                />
              </div>
            </details>

            {mutation.isError ? (
              <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
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
