import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { ApplicationAddressee, ApplicationType } from '@biddaloy/shared';

export interface LetterInput {
  type: ApplicationType;
  payload: Record<string, unknown>;
  subject_student_id?: string | null;
  subject_staff_profile_id?: string | null;
  addressee?: ApplicationAddressee | null;
  addressee_user_id?: string | null;
  applicant_user_id: string | null;
  applicant_name?: string | null; // D46
  serial: string | null; // '2026/0045'; null for the letter preview
  date: string; // 'YYYY-MM-DD', the submit day
}

export interface LetterContext {
  locale: 'bn' | 'en';
  date: string;
  school_name: string;
  to_title: string;
  applicant_name: string;
  applicant_relation: string;
  serial: string | null;
  subject_name: string;
  class_name: string | null;
  section_name: string | null;
  roll: string | null;
  ref_names: Record<string, string>; // e.g. { to_section_id: 'Class 7 · B', exam_id: 'Half-yearly' }
  days: number | null; // working days, leave types only
}

/** Called by 52.2.1 while 52.2.2 builds it in parallel (D48), so it returns empty values for now. */
@Injectable()
export class ApplicationLetterService {
  // [52.2.2] fills this
  async buildContext(
    _manager: EntityManager,
    _tenantId: string,
    input: LetterInput,
  ): Promise<LetterContext> {
    return {
      locale: 'bn',
      date: input.date,
      school_name: '',
      to_title: '',
      applicant_name: '',
      applicant_relation: '',
      serial: input.serial,
      subject_name: '',
      class_name: null,
      section_name: null,
      roll: null,
      ref_names: {},
      days: null,
    };
  }

  // [52.2.2] fills this
  render(_type: ApplicationType, _payload: Record<string, unknown>, _ctx: LetterContext): string {
    return '';
  }
}
