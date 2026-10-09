/**
 * Epic 35.0 curriculum preset pack shape. A pack is plain data (TS, not
 * DB rows) that the server applies to a fresh tenant.
 */
import type { ExamComponentKind, ExamKind } from '../enums/exams';
import type { RegionSettings, PresetSettings } from '../types/tenant-settings.types';

export type PresetCertificateKind = 'TESTIMONIAL' | 'TRANSCRIPT' | 'CHARACTER' | 'TRANSFER';

export interface BilingualText {
  en: string;
  bn: string;
}

export interface PresetGradeBand {
  from: number;
  to: number;
  grade: string;
  gpa: number | null;
  isFail: boolean;
}

export interface PresetExamComponent {
  name: string;
  kind: ExamComponentKind;
  full: number;
  pass: number;
}

export interface PresetExamTemplateRow {
  classGrade: number;
  subjectCode: string;
  components: PresetExamComponent[];
}

export interface PresetExamTemplate {
  name: string;
  kind: ExamKind;
  rows: PresetExamTemplateRow[];
}

export interface PresetMonthDay {
  month: number;
  day: number;
}

export interface PresetPack {
  /** e.g. `'bd/nctb'`. */
  id: string;
  schemaVersion: 1;
  /** e.g. `'2026.1'`. */
  version: string;
  /** ISO 3166-1 alpha-2 or `'INTL'`. */
  country: string;
  name: BilingualText;
  board: BilingualText;
  description: BilingualText;
  verified: boolean;
  region?: Partial<RegionSettings>;
  yearShape: { startMonth: number };
  stages: { key: string; name: BilingualText }[];
  /** Values written to `Class.version`. */
  versions?: { key: string; name: BilingualText }[];
  groups: string[];
  classes: { name: string; numericGrade: number; stage: string }[];
  subjects: { code: string; nameEn: string; nameBn: string }[];
  classSubjects: {
    classGrade: number;
    subjectCode: string;
    group?: string;
    optional?: boolean;
    gradedOnly?: boolean;
    /** Rows of one class sharing a choiceGroup are 'exactly one of' — the student studies one. Never with `optional` or `group`. */
    choiceGroup?: string;
  }[];
  gradingScale: { name: string; bands: PresetGradeBand[] } | null;
  terms: { name: string; seq: number; start: PresetMonthDay; end: PresetMonthDay }[];
  examTemplates: PresetExamTemplate[];
  certificates: PresetCertificateKind[];
}

export interface PresetSummary {
  id: string;
  version: string;
  name: BilingualText;
  board: BilingualText;
  description: BilingualText;
  verified: boolean;
  country: string;
  stages: PresetPack['stages'];
  versions?: PresetPack['versions'];
}

export interface PresetApplyOptions {
  presetId: string;
  startYear: number;
  stages: string[];
  versions: string[];
}

export interface PresetApplyResult {
  created: Record<string, number>;
}

export interface PresetStatus {
  state: 'AVAILABLE' | 'APPLIED' | 'CUSTOM';
  preset?: PresetSettings;
  blockers?: { entity: string; count: number }[];
}
