/**
 * [27.8] The public, no-login admission form at `/admission/<slug>`. Single
 * column, mobile-first (see the wrapper's `max-w-md`), backed by plain
 * `useState` — this repo's other public forms (`SignInForm` et al, and
 * `SchoolSettingsPage`'s own picker) don't use `react-hook-form` either, so
 * this doesn't invent a new form-library pattern (Step 1 of the plan).
 *
 * Document uploads are dynamic: one `FileUpload` per
 * `intake.required_document_types`, keyed by `documentFieldName()` so the
 * multipart field names match what `PublicAdmissionController.submit`
 * expects (`photo`/`birth_certificate`/`transcript`).
 */
import {
  Button,
  Card,
  FileUpload,
  Input,
  Label,
  PhoneInput,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import {
  documentFieldName,
  isUnknownSchool,
  usePublicIntakes,
  useSubmitApplicant,
  type SubmitApplicantInput,
} from './hooks/useSubmitApplicant';

export interface PublicAdmissionFormProps {
  slug: string;
  onSubmitted: (result: { reference_number: string; status: string }) => void;
}

const GENDER_OPTIONS = ['MALE', 'FEMALE', 'OTHER'] as const;

export function PublicAdmissionForm({ slug, onSubmitted }: PublicAdmissionFormProps) {
  const { t } = useTranslation('admission-public');
  const regionConfig = useRegionConfig();
  const intakesQuery = usePublicIntakes(slug);
  const submitMutation = useSubmitApplicant(slug);

  const [intakeId, setIntakeId] = React.useState('');
  const [applicantName, setApplicantName] = React.useState('');
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [gender, setGender] = React.useState<(typeof GENDER_OPTIONS)[number] | ''>('');
  const [guardianName, setGuardianName] = React.useState('');
  const [guardianPhone, setGuardianPhone] = React.useState('');
  const [guardianPhoneValid, setGuardianPhoneValid] = React.useState(false);
  const [guardianEmail, setGuardianEmail] = React.useState('');
  const [homeAddress, setHomeAddress] = React.useState('');
  const [documents, setDocuments] = React.useState<Record<string, File>>({});
  // Honeypot: never rendered visibly (`sr-only` + `tabIndex={-1}`), so a
  // real user never sees or fills it — a bot filling every visible field
  // fills this too. See `SubmitApplicantDto.middle_name_confirm`.
  const [honeypot, setHoneypot] = React.useState('');

  const intakes = intakesQuery.data ?? [];
  const selectedIntake = intakes.find((intake) => intake.id === intakeId);
  const onlyOpenIntakeId = intakes.length === 1 ? intakes[0]?.id : undefined;

  // A single open intake is the common case — pick it automatically so a
  // guardian never has to make a meaningless one-item choice.
  React.useEffect(() => {
    if (!intakeId && onlyOpenIntakeId) setIntakeId(onlyOpenIntakeId);
  }, [intakeId, onlyOpenIntakeId]);

  const missingDocuments = (selectedIntake?.required_document_types ?? []).filter(
    (type) => !documents[documentFieldName(type)],
  );

  const canSubmit =
    !!selectedIntake &&
    applicantName.trim() !== '' &&
    dateOfBirth !== '' &&
    gender !== '' &&
    guardianName.trim() !== '' &&
    guardianPhoneValid &&
    missingDocuments.length === 0 &&
    !submitMutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !selectedIntake) return;

    const input: SubmitApplicantInput = {
      intake_id: selectedIntake.id,
      applicant_name: applicantName.trim(),
      date_of_birth: dateOfBirth,
      gender,
      guardian_name: guardianName.trim(),
      guardian_phone: guardianPhone,
      middle_name_confirm: honeypot,
      documents,
      ...(guardianEmail.trim() ? { guardian_email: guardianEmail.trim() } : {}),
      ...(homeAddress.trim() ? { home_address: homeAddress.trim() } : {}),
    };

    submitMutation.mutate(input, { onSuccess: onSubmitted });
  }

  if (intakesQuery.isPending) {
    return (
      <p role="status" className="text-center text-sm text-muted-foreground">
        {t('form.loading')}
      </p>
    );
  }

  if (intakesQuery.isError) {
    return (
      <Card className="p-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          {isUnknownSchool(intakesQuery.error) ? t('form.schoolNotFound') : t('form.loadError')}
        </p>
      </Card>
    );
  }

  if (intakes.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p role="status" className="text-sm text-muted-foreground">
          {t('form.noOpenIntakes')}
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">{t('form.title')}</h1>

      {intakes.length > 1 && (
        <div className="grid gap-1.5">
          <Label htmlFor="intake">{t('form.fields.intake')}</Label>
          <select
            id="intake"
            className="h-10 rounded-md border border-input bg-card px-2.5 text-sm"
            value={intakeId}
            onChange={(event) => setIntakeId(event.target.value)}
            required
          >
            <option value="">{t('form.fields.intakePlaceholder')}</option>
            {intakes.map((intake) => (
              <option key={intake.id} value={intake.id}>
                {intake.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="applicant-name">{t('form.fields.applicantName')}</Label>
        <Input
          id="applicant-name"
          value={applicantName}
          onChange={(event) => setApplicantName(event.target.value)}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="date-of-birth">{t('form.fields.dateOfBirth')}</Label>
        <Input
          id="date-of-birth"
          type="date"
          value={dateOfBirth}
          onChange={(event) => setDateOfBirth(event.target.value)}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="gender">{t('form.fields.gender')}</Label>
        <select
          id="gender"
          className="h-10 rounded-md border border-input bg-card px-2.5 text-sm"
          value={gender}
          onChange={(event) => setGender(event.target.value as (typeof GENDER_OPTIONS)[number])}
          required
        >
          <option value="">{t('form.fields.genderPlaceholder')}</option>
          {GENDER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`form.fields.genderOptions.${option}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="guardian-name">{t('form.fields.guardianName')}</Label>
        <Input
          id="guardian-name"
          value={guardianName}
          onChange={(event) => setGuardianName(event.target.value)}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="guardian-phone">{t('form.fields.guardianPhone')}</Label>
        <PhoneInput
          id="guardian-phone"
          value={guardianPhone}
          onValueChange={(value, valid) => {
            setGuardianPhone(value);
            setGuardianPhoneValid(valid);
          }}
          config={regionConfig}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="guardian-email">{t('form.fields.guardianEmail')}</Label>
        <Input
          id="guardian-email"
          type="email"
          value={guardianEmail}
          onChange={(event) => setGuardianEmail(event.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="home-address">{t('form.fields.homeAddress')}</Label>
        <Input
          id="home-address"
          value={homeAddress}
          onChange={(event) => setHomeAddress(event.target.value)}
        />
      </div>

      {selectedIntake?.required_document_types.map((type) => {
        const field = documentFieldName(type);
        const file = documents[field];
        return (
          <div key={field} className="grid gap-1.5">
            <Label>{t(`form.documents.${type}`)}</Label>
            <FileUpload
              aria-label={t(`form.documents.${type}`)}
              multiple={false}
              accept="image/png,image/jpeg,image/webp,application/pdf"
              items={
                file ? [{ id: field, file }] : []
              }
              onFilesSelected={([selected]) => {
                if (!selected) return;
                setDocuments((current) => ({ ...current, [field]: selected }));
              }}
              onRemove={() =>
                setDocuments((current) => {
                  const next = { ...current };
                  delete next[field];
                  return next;
                })
              }
            />
          </div>
        );
      })}

      {/* Honeypot: visually and to a screen reader, this field does not
          exist. A real visitor tabbing through the form never reaches it. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="middle-name-confirm">{t('form.fields.honeypot')}</label>
        <input
          id="middle-name-confirm"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      {submitMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('form.submitError')}
        </p>
      )}

      <Button type="submit" loading={submitMutation.isPending} disabled={!canSubmit}>
        {t('form.submit')}
      </Button>
    </form>
  );
}
