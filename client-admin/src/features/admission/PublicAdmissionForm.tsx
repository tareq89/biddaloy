/**
 * [27.8] The public, no-login admission form at `/admission/<slug>`, drawn inside `AuthLayout`
 * by its route. Backed by plain `useState` — this repo's other public forms (`SignInForm`
 * et al) don't use `react-hook-form` either.
 *
 * The page is unauthenticated: it shows only what the public intake endpoint returns, and
 * every message is a translated line (server error text never reaches the screen).
 *
 * Document uploads are dynamic: one `FileUpload` per `intake.required_document_types`,
 * keyed by `documentFieldName()` so the multipart field names match what
 * `PublicAdmissionController.submit` expects (`photo`/`birth_certificate`/`transcript`).
 */
import {
  Button,
  DatePicker,
  EmptyState,
  ErrorState,
  FileUpload,
  Input,
  Label,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { CircleAlertIcon, FileImageIcon, FileTextIcon, XIcon } from 'lucide-react';
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

const SECTION = 'space-y-4 border-t border-border-subtle pt-5';

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
  const [errors, setErrors] = React.useState<Record<string, string>>({});
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

  function clearError(id: string) {
    setErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  /** Field id → translated message, in the order the fields appear (so focus goes to the first). */
  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!selectedIntake) found.intake = t('form.errors.choose');
    if (applicantName.trim() === '') found['applicant-name'] = t('form.errors.required');
    if (dateOfBirth === '') found['date-of-birth'] = t('form.errors.required');
    if (gender === '') found.gender = t('form.errors.choose');
    if (guardianName.trim() === '') found['guardian-name'] = t('form.errors.required');
    if (guardianPhone.trim() === '') found['guardian-phone'] = t('form.errors.required');
    else if (!guardianPhoneValid) found['guardian-phone'] = t('form.errors.phone');
    for (const type of selectedIntake?.required_document_types ?? []) {
      const field = documentFieldName(type);
      if (!documents[field]) found[`doc-${field}`] = t('form.errors.document');
    }
    return found;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitMutation.isPending) return;

    const found = validate();
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    if (!selectedIntake || gender === '') return;

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

  const header = (
    <div>
      <h1 className="text-h1">{t('form.title')}</h1>
      <p className="mt-0.5 text-text-secondary">{t('form.subtitle')}</p>
    </div>
  );

  if (intakesQuery.isPending) {
    return (
      <div>
        {header}
        <div role="status" aria-busy="true" className="mt-5 space-y-4">
          <span className="sr-only">{t('form.loading')}</span>
          {[0, 1, 2].map((group) => (
            <div key={group} className="space-y-2" aria-hidden="true">
              <span className="block h-3 w-24 rounded-sm bg-muted" />
              <span className="block h-11 rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (intakesQuery.isError) {
    return (
      <div>
        {header}
        <div className="mt-5">
          <ErrorState
            message={
              isUnknownSchool(intakesQuery.error) ? t('form.schoolNotFound') : t('form.loadError')
            }
            onRetry={() => void intakesQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  if (intakes.length === 0) {
    return (
      <div>
        {header}
        <div role="status" className="mt-5">
          <EmptyState title={t('form.noOpenIntakes')} explanation={t('form.noOpenIntakesHelp')} />
        </div>
      </div>
    );
  }

  const requiredMark = (
    <>
      <span className="text-destructive" aria-hidden="true">
        {' *'}
      </span>
      <span className="sr-only">{t('form.required')}</span>
    </>
  );

  /** Error line under a control; the control points at it with `aria-describedby`. */
  const fieldError = (id: string) =>
    errors[id] ? (
      <p id={`${id}-error`} className="flex items-center gap-1 text-caption text-destructive">
        <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
        {errors[id]}
      </p>
    ) : null;
  const invalid = (id: string) =>
    errors[id] ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};

  return (
    <div>
      {header}
      <form noValidate onSubmit={handleSubmit} className="mt-5 space-y-6">
        <section className="space-y-3">
          {intakes.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="intake">
                {t('form.fields.intake')}
                {requiredMark}
              </Label>
              <Select
                value={intakeId}
                onValueChange={(value) => {
                  setIntakeId(value);
                  clearError('intake');
                }}
              >
                <SelectTrigger id="intake" {...invalid('intake')}>
                  <SelectValue placeholder={t('form.fields.intakePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {intakes.map((intake) => (
                    <SelectItem key={intake.id} value={intake.id}>
                      {intake.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError('intake')}
            </div>
          )}
          {selectedIntake && (
            <div className="rounded-md bg-muted p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {intakes.length === 1 && (
                  <div className="col-span-2">
                    <dt className="text-caption text-text-secondary">
                      {t('form.intakeFacts.round')}
                    </dt>
                    <dd className="font-medium">{selectedIntake.title}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-caption text-text-secondary">
                    {t('form.intakeFacts.closeDate')}
                  </dt>
                  <dd className="font-medium">
                    {formatDate(selectedIntake.close_date, regionConfig)}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-text-secondary">
                    {t('form.intakeFacts.seats')}
                  </dt>
                  <dd className="font-medium">
                    {t('form.intakeFacts.seatsValue', {
                      count: formatNumber(selectedIntake.seat_count, regionConfig),
                    })}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-caption text-text-secondary">
                    {t('form.intakeFacts.documents')}
                  </dt>
                  <dd className="font-medium">
                    {selectedIntake.required_document_types.length === 0
                      ? t('form.intakeFacts.noDocuments')
                      : selectedIntake.required_document_types
                          .map((type) => t(`form.documents.${type}`))
                          .join(', ')}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </section>

        <section className={SECTION}>
          <h2 className="text-h2">{t('form.sections.student')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="applicant-name">
                {t('form.fields.applicantName')}
                {requiredMark}
              </Label>
              <Input
                id="applicant-name"
                value={applicantName}
                onChange={(event) => {
                  setApplicantName(event.target.value);
                  clearError('applicant-name');
                }}
                {...invalid('applicant-name')}
              />
              {fieldError('applicant-name')}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="date-of-birth">
                {t('form.fields.dateOfBirth')}
                {requiredMark}
              </Label>
              <DatePicker
                id="date-of-birth"
                aria-label={t('form.fields.dateOfBirth')}
                config={regionConfig}
                placeholder={t('form.fields.dateOfBirthPlaceholder')}
                max={new Date()}
                value={dateOfBirth ? parseServerDate(dateOfBirth) : undefined}
                onValueChange={(d) => {
                  setDateOfBirth(d ? toIsoDate(d) : '');
                  clearError('date-of-birth');
                }}
                {...invalid('date-of-birth')}
              />
              {fieldError('date-of-birth')}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="gender">
                {t('form.fields.gender')}
                {requiredMark}
              </Label>
              <Select
                value={gender}
                onValueChange={(value) => {
                  setGender(value as (typeof GENDER_OPTIONS)[number]);
                  clearError('gender');
                }}
              >
                <SelectTrigger id="gender" {...invalid('gender')}>
                  <SelectValue placeholder={t('form.fields.genderPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`form.fields.genderOptions.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError('gender')}
            </div>
          </div>
        </section>

        <section className={SECTION}>
          <h2 className="text-h2">{t('form.sections.guardian')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="guardian-name">
                {t('form.fields.guardianName')}
                {requiredMark}
              </Label>
              <Input
                id="guardian-name"
                value={guardianName}
                onChange={(event) => {
                  setGuardianName(event.target.value);
                  clearError('guardian-name');
                }}
                {...invalid('guardian-name')}
              />
              {fieldError('guardian-name')}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="guardian-phone">
                {t('form.fields.guardianPhone')}
                {requiredMark}
              </Label>
              <PhoneInput
                id="guardian-phone"
                value={guardianPhone}
                onValueChange={(value, valid) => {
                  setGuardianPhone(value);
                  setGuardianPhoneValid(valid);
                  clearError('guardian-phone');
                }}
                config={regionConfig}
                aria-describedby={
                  errors['guardian-phone'] ? 'guardian-phone-error' : 'guardian-phone-help'
                }
              />
              <p id="guardian-phone-help" className="text-caption text-text-secondary">
                {t('form.fields.guardianPhoneHelp')}
              </p>
              {fieldError('guardian-phone')}
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
          </div>
        </section>

        {selectedIntake && selectedIntake.required_document_types.length > 0 && (
          <section className={SECTION}>
            <div>
              <h2 className="text-h2">{t('form.sections.documents')}</h2>
              <p className="mt-1 text-text-secondary">{t('form.sections.documentsHelp')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {selectedIntake.required_document_types.map((type) => {
                const field = documentFieldName(type);
                const file = documents[field];
                const errorId = `doc-${field}`;
                const Icon = type === 'PHOTO' ? FileImageIcon : FileTextIcon;
                return (
                  <div key={field} className="grid content-start gap-1.5">
                    <span className="text-label">
                      {t(`form.documents.${type}`)}
                      {requiredMark}
                    </span>
                    {/* Focus target for the first-error jump (the real control is a button). */}
                    <div id={errorId} tabIndex={-1} className="outline-none">
                      {file ? (
                        <div className="flex items-center gap-2 rounded-md border border-border-subtle p-1 ps-3">
                          <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 text-destructive"
                            aria-label={t('form.documents.remove', { name: file.name })}
                            onClick={() =>
                              setDocuments((current) => {
                                const next = { ...current };
                                delete next[field];
                                return next;
                              })
                            }
                          >
                            <XIcon aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <FileUpload
                          aria-label={t(`form.documents.${type}`)}
                          multiple={false}
                          chooseLabel={t('form.documents.choose')}
                          accept="image/png,image/jpeg,image/webp,application/pdf"
                          items={[]}
                          onFilesSelected={([selected]) => {
                            if (!selected) return;
                            setDocuments((current) => ({ ...current, [field]: selected }));
                            clearError(errorId);
                          }}
                        />
                      )}
                    </div>
                    {fieldError(errorId)}
                  </div>
                );
              })}
            </div>
          </section>
        )}

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
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
            {t('form.submitError')}
          </p>
        )}

        <Button type="submit" className="w-full" loading={submitMutation.isPending}>
          {t('form.submit')}
        </Button>
      </form>

      <div className="mt-2 flex justify-center">
        <Link
          to="/admission/$slug/status"
          params={{ slug }}
          className="inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted"
        >
          {t('form.statusLink')}
        </Link>
      </div>
    </div>
  );
}
