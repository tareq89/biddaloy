/** Step 1 of the register card: the seven fields (D35 order) + captcha. Presentational: no network. */
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parsePhone, toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { COUNTRY_CODES, countryName, defaultCountry } from './country-options';
import { NO_CAPTCHA_TOKEN, TURNSTILE_SITE_KEY, Turnstile } from './turnstile';

export interface RegisterDetailsValues {
  adminName: string;
  schoolName: string;
  country: string;
  address: string;
  phone: string;
  email: string;
  terms: boolean;
}

export interface RegisterDetailsFormProps {
  /** Values to keep (back from the code step) or prefill (social sign-up). */
  initialValues?: Partial<RegisterDetailsValues>;
  initialCountry?: string;
  /** `values.phone` stays as typed (so Change number can restore it); `phone` is international
   * (`+8801…`); `captchaToken` is never empty. */
  onSubmit: (values: RegisterDetailsValues, phone: string, captchaToken: string) => void;
  loading?: boolean;
  /** Bumped by the parent after a failed start: a Turnstile token is single use. */
  captchaResetKey?: number;
  onCaptchaMissing: () => void;
}

export function RegisterDetailsForm({
  initialValues,
  initialCountry,
  onSubmit,
  loading = false,
  captchaResetKey = 0,
  onCaptchaMissing,
}: RegisterDetailsFormProps) {
  const { t } = useTranslation('register');
  const { locale } = useLocale();
  const regionConfig = useRegionConfig();
  const [captcha, setCaptcha] = React.useState<string | null>(null);

  React.useEffect(() => setCaptcha(null), [captchaResetKey]);

  const schema = React.useMemo(
    () =>
      z.object({
        adminName: z.string().trim().min(1, t('validation.required')),
        schoolName: z.string().trim().min(1, t('validation.required')),
        country: z.string().min(1, t('validation.required')),
        address: z.string().trim().min(1, t('validation.required')),
        phone: z
          .string()
          .trim()
          .refine(
            (v) =>
              parsePhone(v, regionConfig).valid ||
              /^\+\d{8,15}$/.test(toLatinDigits(v).replace(/[\s().-]/g, '')),
            t('validation.phone'),
          ),
        email: z.string().trim().email(t('validation.email')),
        terms: z.boolean().refine((v) => v, t('validation.terms')),
      }),
    [regionConfig, t],
  );

  const form = useForm<RegisterDetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      adminName: '',
      schoolName: '',
      address: '',
      phone: '',
      email: '',
      terms: false,
      ...initialValues,
      country: initialValues?.country ?? defaultCountry(initialCountry),
    },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  function handleValid(values: RegisterDetailsValues): void {
    const token = TURNSTILE_SITE_KEY ? captcha : NO_CAPTCHA_TOKEN;
    if (!token) return onCaptchaMissing();
    const parsed = parsePhone(values.phone, regionConfig);
    const phone = parsed.valid
      ? `+${regionConfig.phone.country}${parsed.value}`
      : toLatinDigits(values.phone).replace(/[\s().-]/g, '');
    onSubmit(values, phone, token);
  }

  const text = (
    name: 'adminName' | 'schoolName' | 'address' | 'email',
    label: string,
    extra: React.ComponentProps<typeof Input> = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`register-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input {...field} id={`register-${name}`} disabled={loading} {...extra} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(handleValid)(event)}
        noValidate
        className="flex flex-col gap-4"
      >
        {text('adminName', t('fields.adminName'), { autoComplete: 'name' })}
        {text('schoolName', t('fields.schoolName'), { autoComplete: 'organization' })}
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="register-country">{t('fields.country')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={loading}>
                <FormControl>
                  <SelectTrigger id="register-country">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {COUNTRY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryName(code, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {text('address', t('fields.address'), { autoComplete: 'street-address' })}
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="register-phone">{t('fields.phone')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id="register-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={regionConfig.phone.example}
                  disabled={loading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {text('email', t('fields.email'), { type: 'email', autoComplete: 'email' })}
        <FormField
          control={form.control}
          name="terms"
          render={({ field }) => (
            <FormItem>
              {/* The label stretches over a 44 px row on phone, so the whole row is the tap target. */}
              <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
                <FormControl>
                  <Checkbox
                    id="register-terms"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    disabled={loading}
                  />
                </FormControl>
                <FormLabel
                  htmlFor="register-terms"
                  className="flex flex-1 items-center self-stretch font-normal"
                >
                  {t('terms')}
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Turnstile key={captchaResetKey} onToken={setCaptcha} />
        <Button type="submit" loading={loading} className="w-full">
          {t('continue')}
        </Button>
      </form>
    </Form>
  );
}
