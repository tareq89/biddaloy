import { Injectable } from '@nestjs/common';
import {
  fieldsForRound,
  type AdmissionDocumentType,
  type AdmissionFieldInput,
} from '@biddaloy/shared';
import type { AdmissionIntake } from './entities/admission-intake.entity';

/** Catalogue keys the submit DTO already carries as top-level columns. */
export const CORE_FORM_KEYS = ['name', 'dob', 'gender', 'guardian_name', 'guardian_phone'] as const;

export interface AdmissionFormField {
  key: string;
  label: { bn: string; en: string };
  input: AdmissionFieldInput;
  required: boolean;
  group: string;
  help: string;
  options?: readonly string[];
}

export interface AdmissionFormSchema {
  fields: AdmissionFormField[];
  documents: AdmissionDocumentType[];
}

/** A round's form as an ordered field list (Epic 71 D5): ticked catalogue keys + document slots. */
@Injectable()
export class AdmissionFormSchemaService {
  forRound(
    intake: Pick<AdmissionIntake, 'form_fields' | 'required_document_types'>,
  ): AdmissionFormSchema {
    return {
      fields: fieldsForRound(intake.form_fields ?? []),
      documents: [...(intake.required_document_types ?? [])],
    };
  }

  /** Keys validated as `extra_fields` (everything ticked except the DTO's core fields). */
  extraKeys(intake: Pick<AdmissionIntake, 'form_fields'>): string[] {
    const core = new Set<string>(CORE_FORM_KEYS);
    return fieldsForRound(intake.form_fields ?? [])
      .filter((f) => !core.has(f.key) && f.input !== 'file') // uploads go through the document slots
      .map((f) => f.key);
  }
}
