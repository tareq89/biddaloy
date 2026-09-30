import { AcrAssessment } from '../../../acr/entities/acr-assessment.entity';
import { AcrCriterion } from '../../../acr/entities/acr-criterion.entity';
import { AcrFormVersion } from '../../../acr/entities/acr-form-version.entity';
import { AcrScore } from '../../../acr/entities/acr-score.entity';
import { academicYearsTab } from '../academics/academic-years.tab';
import { createRefChildTab } from './ref-child-tab.factory';
import { usersTab } from './users.tab';

/**
 * [28.1.3] Epic 28.0's ACR tabs, defined in restore order
 * (versions -> criteria -> assessments -> scores). `total` is exported as
 * stored, so a restore reproduces the computed total.
 */
const form_version = {
  key: 'form_version',
  fk: 'form_version_id',
  label: { en: 'Form version', bn: 'ফর্ম সংস্করণ' },
};

export const acrFormVersionsTab = createRefChildTab<AcrFormVersion>({
  name: 'acr_form_versions',
  entityClass: AcrFormVersion,
  refs: [
    { key: 'creator', fk: 'created_by', tab: usersTab, label: { en: 'Created by', bn: 'তৈরি করেছেন' } },
  ],
  fields: [{ key: 'version', type: 'int', required: true, label: { en: 'Version', bn: 'সংস্করণ' } }],
  naturalKey: ['version'],
});

export const acrCriteriaTab = createRefChildTab<AcrCriterion>({
  name: 'acr_criteria',
  entityClass: AcrCriterion,
  refs: [{ ...form_version, tab: acrFormVersionsTab }],
  fields: [
    {
      key: 'block',
      type: 'enum',
      enumValues: ['BLOCK_2', 'BLOCK_3'],
      required: true,
      label: { en: 'Block', bn: 'ব্লক' },
    },
    { key: 'code', type: 'string', required: true, label: { en: 'Code', bn: 'কোড' } },
    { key: 'label_en', type: 'string', required: true, label: { en: 'Label (English)', bn: 'লেবেল (ইংরেজি)' } },
    { key: 'label_bn', type: 'string', required: true, label: { en: 'Label (Bangla)', bn: 'লেবেল (বাংলা)' } },
    { key: 'sort_order', type: 'int', required: true, label: { en: 'Order', bn: 'ক্রম' } },
  ],
  naturalKey: ['form_version', 'block', 'code'],
});

export const acrAssessmentsTab = createRefChildTab<AcrAssessment>({
  name: 'acr_assessments',
  entityClass: AcrAssessment,
  refs: [
    { key: 'user', fk: 'user_id', tab: usersTab, label: { en: 'Staff', bn: 'কর্মী' } },
    {
      key: 'academic_year',
      fk: 'academic_year_id',
      tab: academicYearsTab,
      label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
    },
    { ...form_version, tab: acrFormVersionsTab },
    { key: 'assessor', fk: 'assessed_by', tab: usersTab, label: { en: 'Assessed by', bn: 'মূল্যায়নকারী' } },
  ],
  fields: [
    {
      key: 'status',
      type: 'enum',
      enumValues: ['INCOMPLETE', 'COMPLETED'],
      required: true,
      label: { en: 'Status', bn: 'অবস্থা' },
    },
    { key: 'total', type: 'int', label: { en: 'Total', bn: 'মোট' } },
    { key: 'step1_data', type: 'json', label: { en: 'Step 1 data', bn: 'ধাপ ১ তথ্য' } },
    { key: 'step3_data', type: 'json', label: { en: 'Step 3 data', bn: 'ধাপ ৩ তথ্য' } },
    { key: 'completed_at', type: 'datetime', label: { en: 'Completed at', bn: 'সম্পন্নের সময়' } },
  ],
  naturalKey: ['user', 'academic_year'],
});

export const acrScoresTab = createRefChildTab<AcrScore>({
  name: 'acr_scores',
  entityClass: AcrScore,
  refs: [
    { key: 'assessment', fk: 'assessment_id', tab: acrAssessmentsTab, label: { en: 'Assessment', bn: 'মূল্যায়ন' } },
    { key: 'criterion', fk: 'criterion_id', tab: acrCriteriaTab, label: { en: 'Criterion', bn: 'মানদণ্ড' } },
  ],
  fields: [{ key: 'score', type: 'int', required: true, label: { en: 'Score', bn: 'স্কোর' } }],
  naturalKey: ['assessment', 'criterion'],
});

export const acrTabs = [acrFormVersionsTab, acrCriteriaTab, acrAssessmentsTab, acrScoresTab];
