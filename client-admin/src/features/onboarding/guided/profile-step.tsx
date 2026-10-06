import {
  ErrorState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
} from '@biddaloy/ui/components';
import { useSchoolProfile, useUpdateSchoolProfile } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SchoolLogoField } from '../../../pages/settings/school-profile-section';

import { StepNav } from './step-nav';

const schema = z.object({ name: z.string().trim().min(1), name_bn: z.string() });
type Values = z.infer<typeof schema>;

/** Step 1: name (en / bn) and logo, through the same hooks the Settings profile uses. */
export function ProfileStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation('onboardingSetup');
  const profile = useSchoolProfile();
  const update = useUpdateSchoolProfile();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { name: profile.data?.name ?? '', name_bn: profile.data?.name_bn ?? '' },
  });

  // Read while rendering so react-hook-form tracks it for `save` below.
  const dirty = form.formState.isDirty;

  if (profile.isError) {
    return <ErrorState message={t('saveError')} onRetry={() => void profile.refetch()} />;
  }
  if (!profile.data) return <Skeleton aria-busy="true" className="h-40 w-full" />;

  async function save(values: Values) {
    // Unchanged -> no write; the logo saves itself the moment it is picked.
    if (dirty) {
      try {
        await update.mutateAsync({ name: values.name, name_bn: values.name_bn || null });
      } catch {
        return;
      }
    }
    onNext();
  }

  const field = (name: keyof Values, label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel htmlFor={`guided-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input id={`guided-${name}`} {...f} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => void form.handleSubmit(save)(event)}
      >
        <h2 className="text-h2">{t('guided.profile.title')}</h2>
        <SchoolLogoField logoUrl={profile.data.logo_url} />
        {field('name', t('guided.profile.nameEn'))}
        {field('name_bn', t('guided.profile.nameBn'))}
        <p className="text-caption text-text-secondary">{t('guided.profile.hint')}</p>
        {update.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('saveError')}
          </p>
        )}
        <StepNav
          onBack={onBack}
          onPrimary={() => void form.handleSubmit(save)()}
          busy={update.isPending}
        />
      </form>
    </Form>
  );
}
