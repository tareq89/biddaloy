/**
 * [27.9] Shared create/edit body for an `admission_intakes` row — used by
 * both the create dialog (`IntakeList`) and the edit page (`$intakeId`).
 */
import { AdmissionDocumentType } from '@biddaloy/shared';
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { ALL_DOCUMENT_TYPES, useClassSectionOptions, type IntakeInput } from './hooks/useIntakes';

export interface IntakeFormValue {
  title: string;
  class_section_id: string;
  seat_count: string;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
}

export const EMPTY_INTAKE_FORM: IntakeFormValue = {
  title: '',
  class_section_id: '',
  seat_count: '',
  open_date: '',
  close_date: '',
  required_document_types: [],
};

export function toIntakeInput(value: IntakeFormValue): IntakeInput {
  return {
    title: value.title.trim(),
    class_section_id: value.class_section_id,
    seat_count: Number(value.seat_count),
    open_date: value.open_date,
    close_date: value.close_date,
    required_document_types: value.required_document_types,
  };
}

export function isIntakeFormValid(value: IntakeFormValue): boolean {
  return (
    value.title.trim().length > 0 &&
    value.class_section_id.length > 0 &&
    Number(value.seat_count) > 0 &&
    value.open_date.length > 0 &&
    value.close_date.length > 0 &&
    value.open_date <= value.close_date
  );
}

const DOCUMENT_TYPE_LABEL_KEY: Record<AdmissionDocumentType, string> = {
  [AdmissionDocumentType.PHOTO]: 'form.documentPhoto',
  [AdmissionDocumentType.BIRTH_CERTIFICATE]: 'form.documentBirthCertificate',
  [AdmissionDocumentType.TRANSCRIPT]: 'form.documentTranscript',
};

export function IntakeForm({
  value,
  onChange,
}: {
  value: IntakeFormValue;
  onChange: (value: IntakeFormValue) => void;
}) {
  const { t } = useTranslation('admission-staff-intakes');
  const { options: sectionOptions } = useClassSectionOptions();

  function toggleDocumentType(type: AdmissionDocumentType, checked: boolean) {
    onChange({
      ...value,
      required_document_types: checked
        ? [...value.required_document_types, type]
        : value.required_document_types.filter((existing) => existing !== type),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="intake-title" className="text-sm font-medium">
          {t('form.titleLabel')}
        </label>
        <Input
          id="intake-title"
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('form.classSectionLabel')}</span>
        <Select
          value={value.class_section_id}
          onValueChange={(next) => onChange({ ...value, class_section_id: next })}
        >
          <SelectTrigger aria-label={t('form.classSectionLabel')}>
            <SelectValue placeholder={t('form.classSectionPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {sectionOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.className} · {option.sectionName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="intake-seat-count" className="text-sm font-medium">
          {t('form.seatCountLabel')}
        </label>
        <Input
          id="intake-seat-count"
          type="number"
          min={1}
          value={value.seat_count}
          onChange={(event) => onChange({ ...value, seat_count: event.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="intake-open-date" className="text-sm font-medium">
            {t('form.openDateLabel')}
          </label>
          <Input
            id="intake-open-date"
            type="date"
            value={value.open_date}
            onChange={(event) => onChange({ ...value, open_date: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="intake-close-date" className="text-sm font-medium">
            {t('form.closeDateLabel')}
          </label>
          <Input
            id="intake-close-date"
            type="date"
            value={value.close_date}
            onChange={(event) => onChange({ ...value, close_date: event.target.value })}
          />
        </div>
      </div>

      {value.open_date.length > 0 &&
        value.close_date.length > 0 &&
        value.open_date > value.close_date && (
          <p className="text-sm text-destructive">{t('form.dateRangeError')}</p>
        )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('form.requiredDocumentsLabel')}</span>
        <div className="flex flex-col gap-2">
          {ALL_DOCUMENT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.required_document_types.includes(type)}
                onCheckedChange={(checked) => toggleDocumentType(type, checked === true)}
              />
              {t(DOCUMENT_TYPE_LABEL_KEY[type])}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
