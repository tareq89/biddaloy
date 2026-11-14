import { AdmissionListOrder, AdmissionStageKind, AdmissionTemplateKey } from '../enums/admission';

/** [Epic 71 D1, D20] A round template: default stages and default ticked form fields. */
export interface AdmissionStageDefault {
  kind: AdmissionStageKind;
  order: AdmissionListOrder;
}
export interface AdmissionTemplate {
  stages: AdmissionStageDefault[];
  fields: string[];
}

const BASE = ['name', 'dob', 'gender', 'father_name', 'mother_name', 'guardian_phone'];
const PREV = ['previous_school', 'previous_class'];
const stage = (kind: AdmissionStageKind, order: AdmissionListOrder): AdmissionStageDefault => ({
  kind,
  order,
});
const K = AdmissionStageKind;
const O = AdmissionListOrder;

export const ADMISSION_TEMPLATES: Record<AdmissionTemplateKey, AdmissionTemplate> = {
  [AdmissionTemplateKey.APPLY_ONLY]: { stages: [stage(K.NONE, O.MANUAL)], fields: BASE },
  [AdmissionTemplateKey.WRITTEN]: {
    stages: [stage(K.WRITTEN, O.MERIT)],
    fields: [...BASE, 'photo', ...PREV],
  },
  [AdmissionTemplateKey.WRITTEN_VIVA]: {
    stages: [stage(K.WRITTEN, O.MERIT), stage(K.VIVA, O.MERIT)],
    fields: [...BASE, 'photo', ...PREV],
  },
  [AdmissionTemplateKey.LOTTERY]: { stages: [stage(K.LOTTERY, O.MANUAL)], fields: BASE },
  [AdmissionTemplateKey.FIRST_COME]: {
    stages: [stage(K.FIRST_COME, O.FIRST_COME)],
    fields: BASE,
  },
  [AdmissionTemplateKey.GPA_MERIT]: {
    stages: [stage(K.GPA, O.MERIT)],
    fields: [...BASE, 'photo', 'ssc_gpa', 'ssc_roll', 'ssc_board', 'ssc_year', 'group_preference'],
  },
};
